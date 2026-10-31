import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILabShell
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { Widget } from '@lumino/widgets';

import { isPatchEnabled } from '../patches';

/**
 * The attribute that marks a widget node while a scroll guard is live. Other
 * extensions read it to hold their own scroll restores until the guard
 * releases.
 */
export const GUARD_ATTRIBUTE = 'data-jp-scroll-guard';

/**
 * The window key that records an active patch. A second activation reads it
 * and returns, so a duplicated package cannot connect a second handler.
 */
export const PATCH_MARKER = '__jp_markdown_switch_tab_scrolling_fix__';

/**
 * The switch key in the shared settings schema.
 */
const SWITCH_KEY = 'jupyterlab_markdown_switch_tab_scrolling_fix';

/**
 * The guard polling interval in milliseconds.
 */
const GUARD_INTERVAL_MS = 100;

/**
 * The number of guard polls before the guard releases: 3 seconds.
 */
const MAX_GUARD_ATTEMPTS = 30;

/**
 * The number of consecutive stable polls that release the guard once every
 * image has settled.
 */
const STABILITY_THRESHOLD = 3;

/**
 * Initialization data for the markdown switch-tab scrolling patch.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-core-patches-extension:markdown-switch-tab-scrolling',
  description:
    'Keeps the scroll position of a Markdown view while images load after switching tabs',
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

    // Track active guard intervals to prevent multiple guards on same widget
    const activeGuards = new WeakMap<Widget, number>();

    /**
     * Stop the guard on a widget: clear its interval, forget it and drop the
     * live-guard attribute. No-op when the widget has no guard.
     */
    const releaseGuard = (widget: Widget) => {
      const guardIntervalId = activeGuards.get(widget);
      if (guardIntervalId === undefined) {
        return;
      }
      clearInterval(guardIntervalId);
      activeGuards.delete(widget);
      widget.node.removeAttribute(GUARD_ATTRIBUTE);
    };

    /**
     * Handle widget activation to prevent scroll drift when switching to
     * markdown tabs.
     */
    const handleWidgetActivation = (widget: Widget | null) => {
      if (!widget) {
        return;
      }

      // Find markdown container
      const markdownContainer = widget.node.querySelector(
        '.jp-RenderedMarkdown'
      ) as HTMLElement | null;

      if (!markdownContainer) {
        return;
      }

      // Clear any existing guard for this widget
      releaseGuard(widget);

      // Capture initial scroll position
      const savedScrollTop = markdownContainer.scrollTop;
      const savedScrollLeft = markdownContainer.scrollLeft;

      // Find all images in the markdown
      const images = Array.from(
        markdownContainer.querySelectorAll('img')
      ) as HTMLImageElement[];

      if (images.length === 0) {
        // No images, no need for scroll lock
        return;
      }

      // Track image loading state
      let loadedImageCount = 0;
      const totalImages = images.length;
      let userScrollDetected = false;

      /**
       * Count one image as settled, whether it loaded or failed.
       */
      const imageLoadHandler = (index: number) => {
        return () => {
          loadedImageCount++;
        };
      };

      // Attach load listeners to all images
      images.forEach((img, index) => {
        const handler = imageLoadHandler(index);
        img.addEventListener('load', handler, { once: true });
        img.addEventListener('error', handler, { once: true });

        // If image is already complete, trigger immediately
        if (img.complete && img.naturalHeight !== 0) {
          handler();
        }
      });

      /**
       * Record that the user scrolled, so the guard releases immediately.
       */
      const userScrollHandler = () => {
        userScrollDetected = true;
      };

      // Detect user-initiated scrolling to release lock immediately
      markdownContainer.addEventListener('wheel', userScrollHandler, {
        once: true,
        passive: true
      });
      markdownContainer.addEventListener('touchstart', userScrollHandler, {
        once: true,
        passive: true
      });

      /**
       * Release the guard and the listeners that belong to this activation.
       */
      const stopGuard = () => {
        releaseGuard(widget);
        markdownContainer.removeEventListener('wheel', userScrollHandler);
        markdownContainer.removeEventListener('touchstart', userScrollHandler);
      };

      // Guard mode: lock scroll position while images load
      let guardAttempts = 0;
      let stableCount = 0;

      const guardIntervalId = window.setInterval(() => {
        // Exit immediately if user starts scrolling
        if (userScrollDetected) {
          stopGuard();
          return;
        }

        const currentScrollTop = markdownContainer.scrollTop;
        const drift = Math.abs(currentScrollTop - savedScrollTop);

        // Check if position is stable
        if (drift < 1) {
          stableCount++;
        } else {
          stableCount = 0;
          // Restore scroll position if drift detected
          markdownContainer.scrollTop = savedScrollTop;
          markdownContainer.scrollLeft = savedScrollLeft;
        }

        // Exit if all images loaded and position is stable
        if (
          loadedImageCount >= totalImages &&
          stableCount >= STABILITY_THRESHOLD
        ) {
          stopGuard();
          return;
        }

        guardAttempts++;

        // Timeout after max attempts
        if (guardAttempts >= MAX_GUARD_ATTEMPTS) {
          stopGuard();
        }
      }, GUARD_INTERVAL_MS);

      // Store the guard interval ID and mark the widget as guarded
      activeGuards.set(widget, guardIntervalId);
      widget.node.setAttribute(GUARD_ATTRIBUTE, 'active');
    };

    // Subscribe to shell's currentChanged signal
    labShell.currentChanged.connect((_, args) => {
      handleWidgetActivation(args.newValue);
    });
  }
};

export default plugin;
