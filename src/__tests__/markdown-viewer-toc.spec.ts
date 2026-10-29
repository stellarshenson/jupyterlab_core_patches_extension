import { JupyterFrontEnd } from '@jupyterlab/application';
import { Sanitizer } from '@jupyterlab/apputils';
import { IMarkdownViewerTracker } from '@jupyterlab/markdownviewer';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITableOfContentsTracker } from '@jupyterlab/toc';

import plugin, { PATCH_MARKER } from '../fixes/markdown-viewer-toc';
import {
  NAMED_ID_ATTRIBUTE,
  anchorAttribute,
  cleanFragment,
  findFragmentTarget
} from '../fixes/markdown-viewer-toc/fragment';

/**
 * Activate the plugin against the supplied stand-ins.
 *
 * @param tracker - The Markdown Viewer tracker stand-in
 * @param registry - The rendermime registry stand-in
 * @param tocTracker - The TOC tracker stand-in
 * @param settings - The settings registry stand-in
 */
async function activate(
  tracker: any,
  registry: any,
  tocTracker: any = { get: () => null },
  settings: ISettingRegistry | null = null
): Promise<void> {
  await plugin.activate(
    {} as JupyterFrontEnd,
    tracker,
    registry,
    tocTracker,
    null,
    settings
  );
}

/**
 * A settings registry stand-in whose single switch reads the given value.
 */
function createRegistry(enabled: boolean): ISettingRegistry {
  return {
    load: async () => ({
      get: () => ({ composite: enabled })
    })
  } as unknown as ISettingRegistry;
}

/**
 * A rendermime registry stand-in. `createRenderer` returns an object whose
 * prototype is shared, so the test can inspect the patched `setFragment`.
 */
function createRenderMimeRegistry(allowNamedProperties = false): {
  registry: IRenderMimeRegistry;
  proto: { setFragment: jest.Mock };
  stock: jest.Mock;
} {
  const stock = jest.fn();
  const proto = { setFragment: stock };
  const sanitizer = new Sanitizer();
  sanitizer.setAllowNamedProperties(allowNamedProperties);
  const registry = {
    createRenderer: () => Object.create(proto),
    sanitizer
  } as unknown as IRenderMimeRegistry;
  return { registry, proto, stock };
}

/**
 * A Markdown Viewer tracker stand-in that counts `forEach` calls and
 * `widgetAdded` connections.
 */
function createTracker(widgets: any[] = []): {
  tracker: IMarkdownViewerTracker;
  connections: () => number;
  forEachCalls: () => number;
} {
  let connected = 0;
  let iterated = 0;
  const tracker = {
    forEach: (callback: (widget: any) => void) => {
      iterated++;
      widgets.forEach(callback);
    },
    widgetAdded: {
      connect: (handler: any) => {
        connected++;
        return handler;
      }
    },
    currentWidget: widgets[0] ?? null
  } as unknown as IMarkdownViewerTracker;
  return {
    tracker,
    connections: () => connected,
    forEachCalls: () => iterated
  };
}

/**
 * A Markdown Viewer stand-in with a replaceable `setFragment`, a rendered
 * signal and a disposed signal.
 */
function createViewer(): {
  widget: any;
  content: any;
  node: HTMLElement;
  originalSetFragment: jest.Mock;
} {
  const node = document.createElement('div');
  const originalSetFragment = jest.fn();
  const content = {
    node,
    setFragment: originalSetFragment,
    rendered: { connect: jest.fn() }
  };
  const widget = {
    content,
    isVisible: true,
    disposed: { connect: jest.fn() }
  };
  return { widget, content, node, originalSetFragment };
}

/**
 * A container holding the given heading markup.
 */
function container(html: string): HTMLElement {
  const node = document.createElement('div');
  node.innerHTML = html;
  return node;
}

describe('fragment lookup', () => {
  it('strips the leading hash', () => {
    expect(cleanFragment('#Introduction')).toBe('Introduction');
    expect(cleanFragment('Introduction')).toBe('Introduction');
  });

  it('picks the attribute the sanitizer keeps', () => {
    expect(anchorAttribute(true)).toBe('id');
    expect(anchorAttribute(false)).toBe(NAMED_ID_ATTRIBUTE);
  });

  it('finds a heading through the primary attribute', () => {
    const node = container('<h2 data-jupyter-id="Introduction"></h2>');
    expect(findFragmentTarget(node, '#Introduction', false)).toBe(
      node.querySelector('h2')
    );
  });

  it('finds a heading through the fallback attribute', () => {
    const node = container('<h3 id="Details"></h3>');
    expect(findFragmentTarget(node, '#Details', false)).toBe(
      node.querySelector('h3')
    );
  });

  it('falls back to the percent-decoded fragment', () => {
    const node = container('<h2 data-jupyter-id="Wstęp"></h2>');
    expect(findFragmentTarget(node, '#Wst%C4%99p', false)).toBe(
      node.querySelector('h2')
    );
  });

  it('prefers a literal heading id over its decoded reading', () => {
    const node = container(
      '<h2 data-jupyter-id="Why-%20-appears-in-URLs"></h2>'
    );
    expect(findFragmentTarget(node, '#Why-%20-appears-in-URLs', false)).toBe(
      node.querySelector('h2')
    );
  });

  it('resolves a literal percent escape before an equivalent decoded heading', () => {
    const node = container(
      '<h2 data-jupyter-id="Code-%41"></h2><h2 data-jupyter-id="Code-A"></h2>'
    );
    expect(findFragmentTarget(node, '#Code-%41', false)).toBe(
      node.querySelector('[data-jupyter-id="Code-%41"]')
    );
  });

  it('matches a lowercase fragment against a title-case heading', () => {
    const node = container(
      '<h2 data-jupyter-id="Performance-Optimization"></h2>'
    );
    expect(findFragmentTarget(node, '#performance-optimization', false)).toBe(
      node.querySelector('h2')
    );
  });

  it('returns null when no heading matches', () => {
    const node = container('<h2 data-jupyter-id="Introduction"></h2>');
    expect(findFragmentTarget(node, '#Missing', false)).toBeNull();
  });
});

describe('markdown viewer TOC patch', () => {
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
    const { tracker, connections, forEachCalls } = createTracker();
    const { registry, proto, stock } = createRenderMimeRegistry();

    await activate(tracker, registry, undefined, createRegistry(false));

    expect(proto.setFragment).toBe(stock);
    expect(forEachCalls()).toBe(0);
    expect(connections()).toBe(0);
    expect((window as any)[PATCH_MARKER]).toBeUndefined();
  });

  it('patches the renderer prototype and the tracker when its switch is on', async () => {
    const { tracker, connections } = createTracker();
    const { registry, proto, stock } = createRenderMimeRegistry();

    await activate(tracker, registry, undefined, createRegistry(true));

    expect(proto.setFragment).not.toBe(stock);
    expect(connections()).toBe(1);
    expect((window as any)[PATCH_MARKER]).toBe(true);
  });

  it('scrolls a renderer to a matching element and falls back otherwise', async () => {
    const { tracker } = createTracker();
    const { registry, proto, stock } = createRenderMimeRegistry();
    await activate(tracker, registry);

    const renderer: any = Object.create(proto);
    renderer.node = document.createElement('div');
    const target = document.createElement('h2');
    target.id = 'Introduction';
    target.scrollIntoView = jest.fn();
    renderer.node.appendChild(target);

    renderer.setFragment('#Introduction');
    expect(target.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(stock).not.toHaveBeenCalled();

    renderer.setFragment('#Missing');
    expect(stock).toHaveBeenCalledWith('#Missing');
  });

  it('scrolls the viewer to a case-insensitive heading match', async () => {
    const viewer = createViewer();
    viewer.node.innerHTML =
      '<h2 data-jupyter-id="Performance-Optimization"></h2>';
    const heading = viewer.node.querySelector('h2') as HTMLElement;
    heading.scrollIntoView = jest.fn();

    const { tracker } = createTracker([viewer.widget]);
    const { registry } = createRenderMimeRegistry();
    await activate(tracker, registry);

    viewer.content.setFragment('#performance-optimization');
    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start'
    });
    expect(viewer.originalSetFragment).not.toHaveBeenCalled();

    viewer.content.setFragment('#missing');
    expect(viewer.originalSetFragment).toHaveBeenCalledWith('#missing');
  });

  it('scrolls to the heading of the active TOC item', async () => {
    const viewer = createViewer();
    viewer.node.innerHTML = '<h2 data-jupyter-id="Introduction"></h2>';
    const heading = viewer.node.querySelector('h2') as HTMLElement;
    heading.scrollIntoView = jest.fn();

    const handlers: Array<(model: any, heading: any) => Promise<void>> = [];
    const parser = {
      render: jest.fn(async () => '<h2>Introduction</h2>')
    };
    const model = {
      activeHeadingChanged: {
        connect: (handler: (model: any, heading: any) => Promise<void>) => {
          handlers.push(handler);
        }
      },
      parser
    };
    const tocTracker = {
      get: jest.fn(() => model)
    } as unknown as ITableOfContentsTracker;

    const { tracker } = createTracker([viewer.widget]);
    const { registry } = createRenderMimeRegistry();
    await activate(tracker, registry, tocTracker);

    jest.advanceTimersByTime(100);
    expect(tocTracker.get).toHaveBeenCalledWith(viewer.widget);

    await handlers[0](model, {
      text: 'Introduction',
      raw: '## Introduction',
      level: 2
    });

    expect(parser.render).toHaveBeenCalledWith('## Introduction');
    expect(heading.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start'
    });
  });

  it('is a no-op when activated a second time', async () => {
    const first = createTracker();
    const firstRegistry = createRenderMimeRegistry();
    await activate(first.tracker, firstRegistry.registry);
    const patched = firstRegistry.proto.setFragment;

    const second = createTracker();
    const secondRegistry = createRenderMimeRegistry();
    await activate(second.tracker, secondRegistry.registry);

    expect(second.forEachCalls()).toBe(0);
    expect(second.connections()).toBe(0);
    expect(secondRegistry.proto.setFragment).toBe(secondRegistry.stock);
    expect(firstRegistry.proto.setFragment).toBe(patched);
  });
});
