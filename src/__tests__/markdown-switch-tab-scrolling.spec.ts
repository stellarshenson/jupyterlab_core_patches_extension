import { JupyterFrontEnd, ILabShell } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Widget } from '@lumino/widgets';

import plugin, {
  GUARD_ATTRIBUTE,
  PATCH_MARKER
} from '../fixes/markdown-switch-tab-scrolling';

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
 * Build a widget whose node holds a rendered-markdown container with the
 * requested images. Scroll offsets are stored so a test can assert restores.
 */
function createMarkdownWidget(
  options: { images?: number; loaded?: boolean } = {}
): {
  widget: Widget;
  container: HTMLElement;
  images: HTMLImageElement[];
} {
  const widget = new Widget();
  const container = document.createElement('div');
  container.className = 'jp-RenderedMarkdown';

  let scrollTop = 0;
  let scrollLeft = 0;
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    }
  });
  Object.defineProperty(container, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    }
  });

  const images: HTMLImageElement[] = [];
  const count = options.images ?? 0;
  const loaded = options.loaded ?? false;
  for (let index = 0; index < count; index++) {
    const img = document.createElement('img');
    Object.defineProperty(img, 'complete', {
      configurable: true,
      get: () => loaded
    });
    Object.defineProperty(img, 'naturalHeight', {
      configurable: true,
      get: () => (loaded ? 100 : 0)
    });
    container.appendChild(img);
    images.push(img);
  }

  widget.node.appendChild(container);
  return { widget, container, images };
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

describe('markdown switch-tab scrolling patch', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete (window as any)[PATCH_MARKER];
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    delete (window as any)[PATCH_MARKER];
    document.body.innerHTML = '';
  });

  it('skips the patch when its switch is off', async () => {
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

  it('ignores widgets without rendered markdown or without images', async () => {
    const { shell, fire } = createShell();
    await activate(shell);

    const plain = new Widget();
    fire(plain);
    expect(plain.node.hasAttribute(GUARD_ATTRIBUTE)).toBe(false);

    const { widget } = createMarkdownWidget();
    fire(widget);
    expect(widget.node.hasAttribute(GUARD_ATTRIBUTE)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('restores the captured scroll position while an image loads', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const { widget, container } = createMarkdownWidget({ images: 1 });

    container.scrollTop = 300;
    container.scrollLeft = 12;
    fire(widget);
    expect(widget.node.getAttribute(GUARD_ATTRIBUTE)).toBe('active');

    container.scrollTop = 120;
    container.scrollLeft = 0;
    jest.advanceTimersByTime(TICK_MS);

    expect(container.scrollTop).toBe(300);
    expect(container.scrollLeft).toBe(12);
    expect(widget.node.getAttribute(GUARD_ATTRIBUTE)).toBe('active');
  });

  it('releases the guard on user scrolling and leaves the position alone', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const { widget, container } = createMarkdownWidget({ images: 1 });

    container.scrollTop = 200;
    fire(widget);
    container.dispatchEvent(new Event('wheel'));
    jest.advanceTimersByTime(TICK_MS);

    expect(widget.node.hasAttribute(GUARD_ATTRIBUTE)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);

    container.scrollTop = 50;
    jest.advanceTimersByTime(TICK_MS);
    expect(container.scrollTop).toBe(50);
  });

  it('releases the guard once every image settled and the position is stable', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const { widget } = createMarkdownWidget({ images: 2, loaded: true });

    fire(widget);
    expect(widget.node.getAttribute(GUARD_ATTRIBUTE)).toBe('active');

    jest.advanceTimersByTime(TICK_MS * 3);

    expect(widget.node.hasAttribute(GUARD_ATTRIBUTE)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('treats an image error as a settled image', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const { widget, images } = createMarkdownWidget({ images: 1 });

    fire(widget);
    images[0].dispatchEvent(new Event('error'));
    jest.advanceTimersByTime(TICK_MS * 3);

    expect(widget.node.hasAttribute(GUARD_ATTRIBUTE)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('releases the guard after 30 polls when no image settles', async () => {
    const { shell, fire } = createShell();
    await activate(shell);
    const { widget } = createMarkdownWidget({ images: 1 });

    fire(widget);
    expect(widget.node.getAttribute(GUARD_ATTRIBUTE)).toBe('active');
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(TICK_MS * 30);

    expect(widget.node.hasAttribute(GUARD_ATTRIBUTE)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('is a no-op when activated a second time', async () => {
    const first = createShell();
    await activate(first.shell);
    expect(first.connections()).toBe(1);

    const second = createShell();
    await activate(second.shell);
    expect(second.connections()).toBe(0);

    const { widget } = createMarkdownWidget({ images: 1 });
    second.fire(widget);
    expect(widget.node.hasAttribute(GUARD_ATTRIBUTE)).toBe(false);
  });
});
