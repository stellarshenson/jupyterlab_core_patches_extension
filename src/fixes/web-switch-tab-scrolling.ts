import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILabShell
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { Widget } from '@lumino/widgets';

import { isPatchEnabled } from '../patches';

/**
 * The window key that records an active patch. A second activation reads it
 * and returns, so a duplicated package cannot connect a second handler.
 */
export const PATCH_MARKER = '__jp_web_switch_tab_scrolling_fix__';

/**
 * The switch key in the shared settings schema.
 */
const SWITCH_KEY = 'jupyterlab_web_switch_tab_scrolling_fix';

/**
 * The prefix of one sessionStorage entry; the frame URL follows it.
 */
const STORAGE_PREFIX = 'jp-web-switch-tab-scrolling:';

/**
 * The guard polling interval in milliseconds.
 */
const GUARD_INTERVAL_MS = 100;

/**
 * The number of guard polls before the guard releases: 3 seconds.
 */
const MAX_GUARD_ATTEMPTS = 30;

/**
 * The number of consecutive stable polls that release the guard.
 */
const STABILITY_THRESHOLD = 3;

/**
 * The delay that batches sessionStorage writes on scroll.
 */
const STORAGE_WRITE_MS = 250;

/**
 * One scroll offset, in CSS pixels.
 */
interface IPosition {
  x: number;
  y: number;
}

/**
 * One wheel or touchstart listener attached to a frame while a guard runs.
 */
interface IGuardListener {
  frame: Window;
  handler: () => void;
}

/**
 * Initialization data for the web switch-tab scrolling patch.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-core-patches-extension:web-switch-tab-scrolling',
  description:
    'Keeps the scroll position of an iframe tab across a tab switch, a frame refresh and a page reload',
  autoStart: true,
  requires: [ILabShell],
  optional: [ISettingRegistry],
  activate: async (
    _app: JupyterFrontEnd,
    labShell: ILabShell,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (!(await isPatchEnabled(settingRegistry, SWITCH_KEY))) {
      return;
    }

    // A second activation would connect a second handler and run a second
    // guard over the same widget.
    if ((window as any)[PATCH_MARKER]) {
      return;
    }
    (window as any)[PATCH_MARKER] = true;

    // The last position seen while a frame was visible, by frame URL.
    const positions = new Map<string, IPosition>();

    // A frame document is instrumented once. The key is the Document, not the
    // Window: contentWindow returns the same WindowProxy after a navigation,
    // while the listeners added to the previous inner window are gone.
    const instrumentedDocuments = new WeakSet<Document>();
    // Documents the patch scrolls itself. The scroll event that scroll raises
    // is not a user position and must not overwrite the saved offset.
    const programmaticScrolls = new WeakSet<Document>();
    // The offset the patch itself last applied to a document. A hide snapshot
    // that sees exactly this offset is reading the patch's clamped restore,
    // not a user position.
    const appliedPositions = new WeakMap<Document, IPosition>();
    const loadWatched = new WeakSet<HTMLIFrameElement>();

    // One pending sessionStorage write per URL.
    const pendingWrites = new Map<string, number>();

    // Active guards, their intervals and their user-scroll listeners.
    const activeGuards = new WeakMap<Widget, number>();
    const guardListeners = new WeakMap<Widget, IGuardListener[]>();
    // Widgets whose own hide method the patch wrapped.
    const wrappedHides = new WeakSet<Widget>();

    /**
     * Report whether a frame has a layout box inside a visible widget.
     *
     * Chrome writes scrollY 0 into a frame hidden with display:none. That zero
     * must not overwrite the last visible position, so every record, restore
     * and guard tick checks visibility first.
     */
    const isVisible = (iframe: HTMLIFrameElement): boolean =>
      iframe.offsetParent !== null && iframe.closest('.lm-mod-hidden') === null;

    /**
     * Read the URL of a same-origin frame, or `null` for a cross-origin one.
     * The location read throws for a cross-origin frame; the throw is the
     * signal to skip the frame silently.
     */
    const frameUrl = (iframe: HTMLIFrameElement): string | null => {
      try {
        const frame = iframe.contentWindow;
        return frame ? frame.location.href : null;
      } catch {
        return null;
      }
    };

    /**
     * Read one persisted position from sessionStorage.
     */
    const readStored = (url: string): IPosition | null => {
      try {
        const raw = sessionStorage.getItem(STORAGE_PREFIX + url);
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw) as IPosition;
        if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
          return null;
        }
        return parsed;
      } catch {
        return null;
      }
    };

    /**
     * Write the current position for one URL to sessionStorage, throttled so a
     * scroll produces at most one write per delay. The value is read when the
     * timer fires, so a trailing position wins.
     */
    const writeStored = (url: string): void => {
      if (pendingWrites.has(url)) {
        return;
      }
      const timer = window.setTimeout(() => {
        pendingWrites.delete(url);
        const position = positions.get(url);
        if (!position) {
          return;
        }
        try {
          sessionStorage.setItem(
            STORAGE_PREFIX + url,
            JSON.stringify(position)
          );
        } catch {
          // Storage can be full or blocked; losing the persisted copy is
          // survivable because the in-memory copy still serves this page.
        }
      }, STORAGE_WRITE_MS);
      pendingWrites.set(url, timer);
    };

    /**
     * Store the scroll offset of one frame while it is visible. A hide
     * snapshot skips the offset the patch itself applied last, so a restore
     * clamped by a short document is never stored as the user position.
     */
    const record = (iframe: HTMLIFrameElement, snapshot: boolean): void => {
      if (!isVisible(iframe)) {
        return;
      }
      const url = frameUrl(iframe);
      if (!url) {
        return;
      }
      try {
        const frame = iframe.contentWindow as Window;
        const frameDocument = iframe.contentDocument;
        if (frameDocument && programmaticScrolls.has(frameDocument)) {
          programmaticScrolls.delete(frameDocument);
          return;
        }
        const offset = { x: frame.scrollX, y: frame.scrollY };
        if (snapshot && frameDocument) {
          const applied = appliedPositions.get(frameDocument);
          if (applied && applied.x === offset.x && applied.y === offset.y) {
            return;
          }
        }
        positions.set(url, offset);
        writeStored(url);
      } catch {
        // A frame that became cross-origin between the two reads is skipped.
      }
    };

    /**
     * Move a visible frame to its stored position. A position absent from
     * memory is read from sessionStorage, which carries it across a full page
     * reload. Returns nothing; a cross-origin frame is skipped.
     */
    const restore = (iframe: HTMLIFrameElement): void => {
      const url = frameUrl(iframe);
      if (!url) {
        return;
      }
      let position = positions.get(url) ?? null;
      if (!position) {
        position = readStored(url);
        if (position) {
          positions.set(url, position);
        }
      }
      if (!position) {
        return;
      }
      try {
        const frame = iframe.contentWindow as Window;
        const frameDocument = iframe.contentDocument;
        const beforeX = frame.scrollX;
        const beforeY = frame.scrollY;
        if (frameDocument) {
          programmaticScrolls.add(frameDocument);
        }
        frame.scrollTo({
          left: position.x,
          top: position.y,
          behavior: 'instant'
        });
        // A scroll request that moves nothing raises no scroll event, so the
        // mark would otherwise drop the next user scroll.
        if (
          frameDocument &&
          frame.scrollX === beforeX &&
          frame.scrollY === beforeY
        ) {
          programmaticScrolls.delete(frameDocument);
        }
        if (frameDocument) {
          appliedPositions.set(frameDocument, {
            x: frame.scrollX,
            y: frame.scrollY
          });
        }
      } catch {
        // Cross-origin frames are skipped silently.
      }
    };

    /**
     * Attach the scroll recorder to a frame's current document and the load
     * listener to its element, once each. A refresh installs a new Document,
     * so the load listener instruments the new document.
     */
    const instrument = (iframe: HTMLIFrameElement, widget: Widget): void => {
      const frame = iframe.contentWindow;
      if (!frame) {
        return;
      }
      // The first location read also decides cross-origin: a throw skips the
      // frame without a listener and without console output.
      if (!frameUrl(iframe)) {
        return;
      }
      let frameDocument: Document | null = null;
      try {
        frameDocument = iframe.contentDocument;
      } catch {
        // Cross-origin frames are skipped silently.
        return;
      }
      if (frameDocument && !instrumentedDocuments.has(frameDocument)) {
        instrumentedDocuments.add(frameDocument);
        frame.addEventListener('scroll', () => record(iframe, false), {
          passive: true
        });
      }
      if (!loadWatched.has(iframe)) {
        loadWatched.add(iframe);
        iframe.addEventListener('load', () => {
          instrument(iframe, widget);
          if (isVisible(iframe)) {
            handleWidgetActivation(widget);
          }
        });
      }
    };

    /**
     * Stop the guard on a widget: clear its interval, drop its user-scroll
     * listeners and forget it. No-op when the widget has no guard.
     */
    const releaseGuard = (widget: Widget): void => {
      const interval = activeGuards.get(widget);
      if (interval === undefined) {
        return;
      }
      clearInterval(interval);
      activeGuards.delete(widget);
      const listeners = guardListeners.get(widget) ?? [];
      listeners.forEach(({ frame, handler }) => {
        try {
          frame.removeEventListener('wheel', handler);
          frame.removeEventListener('touchstart', handler);
        } catch {
          // The frame navigated or went cross-origin; nothing is left to
          // remove from it.
        }
      });
      guardListeners.delete(widget);
    };

    /**
     * Restore every frame of an activated web widget, then hold the position
     * for at most 3 seconds. The guard stops early on a user wheel or touch
     * scroll, or once the position has been stable for three polls.
     */
    const handleWidgetActivation = (widget: Widget | null): void => {
      if (!widget) {
        return;
      }
      const frames = Array.from(
        widget.node.querySelectorAll('.jp-IFrame iframe')
      ) as HTMLIFrameElement[];
      if (frames.length === 0) {
        return;
      }

      releaseGuard(widget);

      let userScrolled = false;
      const listeners: IGuardListener[] = [];

      frames.forEach(iframe => {
        instrument(iframe, widget);
        restore(iframe);
      });

      // Chrome queues a frame scroll event to the next rendering step. If the
      // tab hides first, the event fires with the frame already reset to 0
      // and record() skips it, so snapshot the visible frames in the widget's
      // own hide before the hide applies.
      if (!wrappedHides.has(widget)) {
        wrappedHides.add(widget);
        const originalHide = widget.hide as (...args: unknown[]) => unknown;
        widget.hide = (...args: unknown[]): unknown => {
          Array.from(widget.node.querySelectorAll('.jp-IFrame iframe')).forEach(
            iframe => record(iframe as HTMLIFrameElement, true)
          );
          return originalHide.apply(widget, args);
        };
      }

      frames.forEach(iframe => {
        try {
          const frame = iframe.contentWindow;
          if (!frame) {
            return;
          }
          const handler = () => {
            userScrolled = true;
          };
          frame.addEventListener('wheel', handler, { passive: true });
          frame.addEventListener('touchstart', handler, { passive: true });
          listeners.push({ frame, handler });
        } catch {
          // Cross-origin frames cannot carry a listener and need no guard.
        }
      });
      guardListeners.set(widget, listeners);

      let attempts = 0;
      let stable = 0;

      const interval = window.setInterval(() => {
        if (userScrolled) {
          releaseGuard(widget);
          return;
        }

        let drifted = false;
        frames.forEach(iframe => {
          if (!isVisible(iframe)) {
            return;
          }
          const url = frameUrl(iframe);
          const target = url ? positions.get(url) : undefined;
          if (!url || !target) {
            return;
          }
          try {
            const frame = iframe.contentWindow as Window;
            if (
              Math.abs(frame.scrollX - target.x) >= 1 ||
              Math.abs(frame.scrollY - target.y) >= 1
            ) {
              const frameDocument = iframe.contentDocument;
              const beforeX = frame.scrollX;
              const beforeY = frame.scrollY;
              if (frameDocument) {
                programmaticScrolls.add(frameDocument);
              }
              frame.scrollTo({
                left: target.x,
                top: target.y,
                behavior: 'instant'
              });
              // A clamped scroll that moves nothing raises no scroll event,
              // so the mark would otherwise drop the next user scroll.
              if (
                frameDocument &&
                frame.scrollX === beforeX &&
                frame.scrollY === beforeY
              ) {
                programmaticScrolls.delete(frameDocument);
              }
              if (frameDocument) {
                appliedPositions.set(frameDocument, {
                  x: frame.scrollX,
                  y: frame.scrollY
                });
              }
              drifted = true;
            }
          } catch {
            // Cross-origin frames are skipped silently.
          }
        });

        stable = drifted ? 0 : stable + 1;
        attempts++;
        if (stable >= STABILITY_THRESHOLD || attempts >= MAX_GUARD_ATTEMPTS) {
          releaseGuard(widget);
        }
      }, GUARD_INTERVAL_MS);

      activeGuards.set(widget, interval);
    };

    // Subscribe to shell's currentChanged signal
    labShell.currentChanged.connect((_, args) => {
      handleWidgetActivation(args.newValue);
    });
  }
};

export default plugin;
