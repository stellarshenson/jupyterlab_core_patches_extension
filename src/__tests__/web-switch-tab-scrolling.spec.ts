import { JupyterFrontEnd, ILabShell } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Widget } from '@lumino/widgets';

import plugin, { PATCH_MARKER } from '../fixes/web-switch-tab-scrolling';

// The build's tsconfig carries only the jest globals; require reads the
// shipped schema without pulling in the Node type package.
declare function require(id: string): any;

/**
 * One shell activation handler registered by the plugin.
 */
type ActivationHandler = (
  sender: unknown,
  args: { newValue: Widget | null }
) => void;

/**
 * The guard polls every 100 ms.
 */
const TICK_MS = 100;

/**
 * The frame URL every harness uses unless a test names another one.
 */
const FRAME_URL = 'http://localhost/files/tall.html';

/**
 * The sessionStorage prefix the patch writes with.
 */
const STORAGE_PREFIX = 'jp-web-switch-tab-scrolling:';

/**
 * One scroll request the patch made through the frame window.
 */
interface IScrollRequest {
  left: number;
  top: number;
  behavior: ScrollBehavior | undefined;
}

/**
 * The frame stand-in: a widget whose node holds a `.jp-IFrame` element, an
 * iframe with a readable contentWindow and a scroll offset a test can drive.
 */
interface FrameHarness {
  widget: Widget;
  iframe: HTMLIFrameElement;
  scroll: () => { x: number; y: number };
  scrollTo: (x: number, y: number) => void;
  scrollRequests: () => IScrollRequest[];
  setMaxY: (value: number) => void;
  dispatch: (type: string) => void;
  listenerCount: (type: string) => number;
  setVisible: (value: boolean) => void;
  dispatchLoad: () => void;
}

/**
 * Build a frame harness. A cross-origin frame throws on every contentWindow
 * read the patch makes, exactly as a real cross-origin frame does.
 */
function createFrameHarness(
  options: { url?: string; crossOrigin?: boolean } = {}
): FrameHarness {
  const url = options.url ?? FRAME_URL;
  const crossOrigin = options.crossOrigin ?? false;

  const widget = new Widget();
  widget.addClass('jp-MainAreaWidget');
  const frameWidget = document.createElement('div');
  frameWidget.className = 'jp-IFrame';
  const iframe = document.createElement('iframe');
  frameWidget.appendChild(iframe);
  widget.node.appendChild(frameWidget);
  document.body.appendChild(widget.node);

  let x = 0;
  let y = 0;
  let maxY = Number.POSITIVE_INFINITY;
  let visible = true;
  const listeners = new Map<string, Set<EventListener>>();
  const scrollRequests: IScrollRequest[] = [];

  const emit = (type: string): void => {
    listeners.get(type)?.forEach(handler => handler(new Event(type)));
  };

  /**
   * Throw the error a browser throws on a cross-origin window read.
   */
  const deny = (): never => {
    throw new DOMException('Blocked a frame', 'SecurityError');
  };

  const frameWindow = {
    get location() {
      if (crossOrigin) {
        deny();
      }
      return { href: url };
    },
    get scrollX() {
      if (crossOrigin) {
        deny();
      }
      return x;
    },
    get scrollY() {
      if (crossOrigin) {
        deny();
      }
      return y;
    },
    scrollTo(next: number | ScrollToOptions, nextY?: number) {
      if (crossOrigin) {
        deny();
      }
      const left = typeof next === 'number' ? next : (next.left ?? 0);
      const top = typeof next === 'number' ? (nextY ?? 0) : (next.top ?? 0);
      const behavior = typeof next === 'number' ? undefined : next.behavior;
      scrollRequests.push({ left, top, behavior });
      // A real frame clamps the request to the document height and raises a
      // scroll event when the offset moves.
      const clampedY = Math.min(top, maxY);
      if (left === x && clampedY === y) {
        return;
      }
      x = left;
      y = clampedY;
      emit('scroll');
    },
    addEventListener(type: string, handler: EventListener) {
      if (crossOrigin) {
        deny();
      }
      const handlers = listeners.get(type) ?? new Set<EventListener>();
      handlers.add(handler);
      listeners.set(type, handlers);
    },
    removeEventListener(type: string, handler: EventListener) {
      listeners.get(type)?.delete(handler);
    }
  };

  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    get: () => frameWindow as unknown as Window
  });
  Object.defineProperty(iframe, 'offsetParent', {
    configurable: true,
    get: () => (visible ? frameWidget : null)
  });

  return {
    widget,
    iframe,
    scroll: () => ({ x, y }),
    scrollTo: (nextX, nextY) => {
      x = nextX;
      y = nextY;
    },
    scrollRequests: () => scrollRequests,
    setMaxY: value => {
      maxY = value;
    },
    dispatch: type => emit(type),
    listenerCount: type => listeners.get(type)?.size ?? 0,
    setVisible: value => {
      visible = value;
      widget.node.classList.toggle('lm-mod-hidden', !value);
    },
    dispatchLoad: () => {
      iframe.dispatchEvent(new Event('load'));
    }
  };
}

/**
 * A shell stand-in that records `currentChanged` handlers and fires them on
 * demand.
 */
function createShell(): {
  shell: ILabShell;
  fire: (widget: Widget | null) => void;
  connections: () => number;
} {
  const handlers: ActivationHandler[] = [];
  const shell = {
    currentChanged: {
      connect: (handler: ActivationHandler): ActivationHandler => {
        handlers.push(handler);
        return handler;
      }
    }
  } as unknown as ILabShell;
  return {
    shell,
    fire: widget => {
      handlers.forEach(handler => handler(null, { newValue: widget }));
    },
    connections: () => handlers.length
  };
}

/**
 * A settings registry stub whose switch key reads the given value.
 */
function createRegistry(enabled: boolean): ISettingRegistry {
  return {
    load: async () => ({
      get: () => ({ composite: enabled })
    })
  } as unknown as ISettingRegistry;
}

/**
 * Activate the plugin against the stand-in shell.
 */
async function activate(
  shell: ILabShell,
  registry: ISettingRegistry | null = null
): Promise<void> {
  await plugin.activate({} as JupyterFrontEnd, shell, registry);
}

describe('web switch-tab scrolling patch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sessionStorage.clear();
    delete (window as any)[PATCH_MARKER];
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    sessionStorage.clear();
    delete (window as any)[PATCH_MARKER];
    document.body.innerHTML = '';
  });

  it('declares a default-on switch and skips the patch when it is off', async () => {
    const schema = require('../../schema/plugin.json');
    expect(schema.properties.jupyterlab_web_switch_tab_scrolling_fix.type).toBe(
      'boolean'
    );
    expect(
      schema.properties.jupyterlab_web_switch_tab_scrolling_fix.default
    ).toBe(true);

    const { shell, connections } = createShell();
    await activate(shell, createRegistry(false));
    expect(connections()).toBe(0);
    expect((window as any)[PATCH_MARKER]).toBeUndefined();
  });

  it('connects to the shell when its switch is on', async () => {
    const { shell, connections } = createShell();
    await activate(shell, createRegistry(true));
    expect(connections()).toBe(1);
    expect((window as any)[PATCH_MARKER]).toBe(true);
  });

  it('records the scroll position while the frame is visible', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 1200);
    harness.dispatch('scroll');

    harness.setVisible(false);
    harness.scrollTo(0, 0);
    harness.dispatch('scroll');
    harness.setVisible(true);
    fire(harness.widget);

    expect(harness.scroll().y).toBe(1200);
  });

  it('ignores the zero Chrome writes while the frame is hidden', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 900);
    harness.dispatch('scroll');

    harness.setVisible(false);
    harness.scrollTo(0, 0);
    harness.dispatch('scroll');
    harness.setVisible(true);
    fire(harness.widget);

    expect(harness.scroll().y).toBe(900);
  });

  it('restores the stored position when the tab is activated', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 900);
    harness.dispatch('scroll');

    harness.scrollTo(0, 0);
    fire(harness.widget);

    expect(harness.scroll().y).toBe(900);
  });

  it('records the visible position from the widget hide before it applies', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    // The first activation installs the hide wrapper.
    fire(harness.widget);

    // The scroll event is still queued to the next rendering step when the
    // tab hides, so only the wrapper sees the visible offset.
    harness.scrollTo(0, 900);
    harness.widget.hide();
    harness.scrollTo(0, 0);
    harness.widget.show();

    fire(harness.widget);

    expect(harness.scroll().y).toBe(900);
  });

  it('restores the stored position when the frame reloads', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 900);
    harness.dispatch('scroll');

    harness.scrollTo(0, 0);
    harness.dispatchLoad();

    expect(harness.scroll().y).toBe(900);
  });

  it('keeps the saved offset when a reload clamps the scroll and the page grows', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 900);
    harness.dispatch('scroll');
    jest.advanceTimersByTime(250);

    // The reload shows the top of a short document, so the patch's own scroll
    // to 900 clamps to 300 and raises a scroll event.
    harness.setMaxY(300);
    harness.scrollTo(0, 0);
    harness.dispatchLoad();
    expect(harness.scroll().y).toBe(300);
    // The restore and the guard both scroll instantly; the two-argument form
    // would follow the page's own smooth scroll behavior instead.
    expect(harness.scrollRequests()).toEqual([
      { left: 0, top: 900, behavior: 'instant' }
    ]);

    // The document grows and the guard reaches the saved position.
    harness.setMaxY(1200);
    jest.advanceTimersByTime(TICK_MS);

    expect(harness.scroll().y).toBe(900);
    expect(harness.scrollRequests()).toEqual([
      { left: 0, top: 900, behavior: 'instant' },
      { left: 0, top: 900, behavior: 'instant' }
    ]);
    expect(
      JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}${FRAME_URL}`)!)
    ).toEqual({ x: 0, y: 900 });
  });

  it('does not let the hide snapshot store the clamped restore offset', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 900);
    harness.dispatch('scroll');
    jest.advanceTimersByTime(250);

    // The reload shows the top of a short document, so the restore clamps to
    // 300. The tab hides before the document grows, and the snapshot must not
    // store that clamped offset as the user position.
    harness.setMaxY(300);
    harness.scrollTo(0, 0);
    harness.dispatchLoad();
    expect(harness.scroll().y).toBe(300);

    harness.widget.hide();
    jest.advanceTimersByTime(250);

    // The document grows and the tab returns; the saved 900 is restored.
    harness.setMaxY(1200);
    harness.widget.show();
    fire(harness.widget);

    expect(harness.scroll().y).toBe(900);
    expect(
      JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}${FRAME_URL}`)!)
    ).toEqual({ x: 0, y: 900 });
  });

  it('keeps a user scroll after a restore that moved nothing', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 900);
    harness.dispatch('scroll');
    harness.scrollTo(0, 0);
    harness.dispatch('scroll');

    // The restore to {0, 0} moves nothing. Without clearing the mark its
    // stale entry swallows the next user scroll.
    fire(null);
    fire(harness.widget);

    harness.scrollTo(0, 400);
    harness.dispatch('scroll');

    fire(null);
    fire(harness.widget);

    expect(harness.scroll().y).toBe(400);
  });

  it('keeps a user scroll after the guard ends on a clamped restore', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 900);
    harness.dispatch('scroll');
    jest.advanceTimersByTime(250);

    // The reload shows a short document, so every restore and guard poll
    // requests 900 and moves nothing until the guard gives up.
    harness.setMaxY(300);
    harness.scrollTo(0, 0);
    harness.dispatchLoad();
    jest.advanceTimersByTime(TICK_MS * 30);
    expect(harness.scroll().y).toBe(300);

    // The document grows, and the next user scroll must not be swallowed by
    // a mark left by the final no-op guard poll.
    harness.setMaxY(1200);
    harness.scrollTo(0, 400);
    harness.dispatch('scroll');

    fire(null);
    fire(harness.widget);

    expect(harness.scroll().y).toBe(400);
  });

  it('restores the position persisted in sessionStorage after a page reload', async () => {
    sessionStorage.setItem(
      `${STORAGE_PREFIX}${FRAME_URL}`,
      JSON.stringify({ x: 0, y: 900 })
    );

    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);

    expect(harness.scroll().y).toBe(900);
    expect(jest.getTimerCount()).toBeGreaterThan(0);
  });

  it('stops the guard on a user wheel scroll and keeps the user position', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness();

    fire(harness.widget);
    harness.scrollTo(0, 900);
    harness.dispatch('scroll');

    fire(harness.widget);
    expect(harness.scroll().y).toBe(900);

    harness.scrollTo(0, 300);
    harness.dispatch('scroll');
    harness.dispatch('wheel');
    // One tick releases the guard; the trailing 250 ms storage write runs
    // next and leaves no timer behind.
    jest.advanceTimersByTime(TICK_MS + 250);

    expect(harness.scroll().y).toBe(300);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('skips a cross-origin frame without an error', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    const { shell, fire } = createShell();
    await activate(shell);
    const harness = createFrameHarness({ crossOrigin: true });

    expect(() => fire(harness.widget)).not.toThrow();
    jest.advanceTimersByTime(TICK_MS * 30);

    expect(harness.listenerCount('scroll')).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('is a no-op when activated a second time', async () => {
    const first = createShell();
    await activate(first.shell);
    expect(first.connections()).toBe(1);

    const second = createShell();
    await activate(second.shell);
    expect(second.connections()).toBe(0);

    const harness = createFrameHarness();
    second.fire(harness.widget);
    expect(harness.listenerCount('scroll')).toBe(0);
  });
});
