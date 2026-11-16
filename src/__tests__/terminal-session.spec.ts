import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { Signal } from '@lumino/signaling';

import restorePlugin, { PATCH_MARKER } from '../fixes/restore-terminals';
import { requestAPI } from '../fixes/restore-terminals/request';
import cprEscapePlugin from '../fixes/terminal-cpr-escape';
import {
  OPEN_REPORT_DELAYS_MS,
  POLL_INTERVAL_MS
} from '../fixes/terminal-session';

// The build's tsconfig carries only the jest globals; require reads the
// shipped schema without pulling in the Node type package.
declare function require(id: string): any;

jest.mock('../fixes/restore-terminals/request');

const mockedRequestAPI = requestAPI as jest.MockedFunction<typeof requestAPI>;

/**
 * The switch key of the terminal CPR escape patch.
 */
const CPR_ESCAPE_SWITCH = 'jupyterlab_terminal_cpr_escape_fix';

/**
 * The switch key of the restore terminals patch.
 */
const RESTORE_SWITCH = 'jupyterlab_restore_terminals_fix';

/**
 * The size JupyterLab reports for an xterm that was never opened.
 */
const UNFITTED_SIZE = { type: 'set_size', content: [24, 80, 903, 1522] };

/**
 * A message the shell receives as typed input.
 */
const STDIN = { type: 'stdin', content: ['ls\r'] };

/**
 * The two activation orders of the terminal plugins.
 */
const ORDERS = ['CPR escape first', 'restore first'] as const;

/**
 * One registered `widgetAdded` handler.
 */
type WidgetAddedHandler = (sender: unknown, widget: unknown) => void;

/**
 * A terminal tracker stand-in that records `widgetAdded` handlers and fires
 * them on demand. `fire` also adds the widget to the list `forEach` walks.
 */
function createTracker(): {
  tracker: ITerminalTracker;
  fire: (widget: unknown) => void;
  connections: () => number;
} {
  const handlers: WidgetAddedHandler[] = [];
  const widgets: unknown[] = [];
  const tracker = {
    widgetAdded: {
      connect: (handler: WidgetAddedHandler): WidgetAddedHandler => {
        handlers.push(handler);
        return handler;
      }
    },
    forEach: (callback: (widget: unknown) => void) => widgets.forEach(callback)
  } as unknown as ITerminalTracker;
  return {
    tracker,
    fire: widget => {
      widgets.push(widget);
      handlers.forEach(handler => handler(null, widget));
    },
    connections: () => handlers.length
  };
}

/**
 * A terminal widget in a hidden tab whose session JupyterLab gave up on.
 * `wraps` counts the assignments to `session.send`. `reconnect` turns the
 * status `connecting` at once, as the stock session does.
 */
function fakeTerminal(name = '1') {
  const send = jest.fn();
  const session: any = {
    name,
    model: { name },
    connectionStatus: 'disconnected',
    isDisposed: false
  };
  let current: unknown = send;
  let wraps = 0;
  Object.defineProperty(session, 'send', {
    get: () => current,
    set: (value: unknown) => {
      wraps++;
      current = value;
    }
  });
  const reconnect = jest.fn(() => {
    session.connectionStatus = 'connecting';
    return Promise.resolve();
  });
  session.reconnect = reconnect;
  const terminal: any = { node: document.createElement('div'), session };
  terminal.disposed = new Signal<any, void>(terminal);
  return { terminal, send, reconnect, wraps: () => wraps };
}

/**
 * What xterm.js does in `Terminal.open()`: append its element to the widget
 * node.
 */
function open(terminal: any): void {
  const element = document.createElement('div');
  element.className = 'terminal xterm';
  terminal.node.appendChild(element);
}

/**
 * A settings registry stand-in with one value per terminal switch; every
 * other key, `redrawBackgroundTerminals` included, reads `true`.
 */
function createRegistry(
  cprEscape: boolean,
  restore: boolean
): ISettingRegistry {
  const values: Record<string, boolean> = {
    [CPR_ESCAPE_SWITCH]: cprEscape,
    [RESTORE_SWITCH]: restore
  };
  return {
    load: async () => ({
      get: (key: string) => ({ composite: values[key] ?? true })
    })
  } as unknown as ISettingRegistry;
}

/**
 * An app stand-in with the terminal manager the CPR escape plugin reads, the
 * session `1` running at page load, and the server settings the restore
 * plugin reads.
 */
function createApp(): JupyterFrontEnd {
  const terminals = {
    ready: Promise.resolve(),
    running: () => [{ name: '1' }][Symbol.iterator](),
    runningChanged: new Signal<object, { name: string }[]>({})
  };
  return {
    serviceManager: { terminals, serverSettings: {} }
  } as unknown as JupyterFrontEnd;
}

/**
 * Activate both terminal plugins on one tracker, in `order`.
 */
async function activateBoth(
  tracker: ITerminalTracker,
  registry: ISettingRegistry,
  order: (typeof ORDERS)[number] = 'CPR escape first'
): Promise<void> {
  const app = createApp();
  const cprEscape = () => cprEscapePlugin.activate(app, tracker, registry);
  const restore = () => restorePlugin.activate(app, tracker, registry);
  if (order === 'CPR escape first') {
    await cprEscape();
    await restore();
  } else {
    await restore();
    await cprEscape();
  }
}

describe('terminal session module', () => {
  let documentListener: jest.SpyInstance;
  let windowListener: jest.SpyInstance;

  /**
   * The number of `type` listeners added on `document` and `window` since the
   * test started.
   */
  const listeners = (type: string): number =>
    [...documentListener.mock.calls, ...windowListener.mock.calls].filter(
      ([added]) => added === type
    ).length;

  beforeEach(() => {
    jest.useFakeTimers();
    mockedRequestAPI.mockClear();
    delete (window as any)[PATCH_MARKER];
    documentListener = jest.spyOn(document, 'addEventListener');
    windowListener = jest.spyOn(window, 'addEventListener');
  });

  afterEach(() => {
    documentListener.mockRestore();
    windowListener.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
    delete (window as any)[PATCH_MARKER];
  });

  it.each(ORDERS)(
    'connects widgetAdded once and wraps send once per session with both plugins on, %s (ACC-PATCH-50)',
    async order => {
      const { tracker, fire, connections } = createTracker();
      await activateBoth(tracker, createRegistry(true, true), order);

      expect(connections()).toBe(1);

      const { terminal, send, reconnect, wraps } = fakeTerminal();
      fire({ content: terminal });
      expect(wraps()).toBe(1);

      // The held background tab drops the unfitted size and still
      // reconnects on typed input.
      terminal.session.send(UNFITTED_SIZE);
      terminal.session.send(STDIN);
      expect(send.mock.calls).toEqual([[STDIN]]);
      expect(reconnect).toHaveBeenCalledTimes(1);

      // The hold releases at the open; the one wrapper stays for typing.
      open(terminal);
      await Promise.resolve();
      terminal.session.connectionStatus = 'disconnected';
      terminal.session.send(STDIN);

      expect(reconnect).toHaveBeenCalledTimes(2);
      expect(wraps()).toBe(1);
    }
  );

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false]
  ])(
    'CPR escape switch %s, restore switch %s: only the enabled parts act (ACC-PATCH-51)',
    async (cprEscape, restore) => {
      const { tracker, fire, connections } = createTracker();
      await activateBoth(tracker, createRegistry(cprEscape, restore));
      const { terminal, send, reconnect, wraps } = fakeTerminal();
      fire({ content: terminal });

      terminal.session.send(UNFITTED_SIZE);
      terminal.session.send(STDIN);
      jest.advanceTimersByTime(POLL_INTERVAL_MS);

      expect(connections()).toBe(cprEscape || restore ? 1 : 0);
      expect(wraps()).toBe(cprEscape ? 1 : 0);
      expect(send.mock.calls).toEqual(
        cprEscape ? [[STDIN]] : [[UNFITTED_SIZE], [STDIN]]
      );
      expect(reconnect).toHaveBeenCalledTimes(cprEscape ? 1 : 0);
      expect(listeners('visibilitychange')).toBe(cprEscape ? 1 : 0);
      expect(listeners('online')).toBe(cprEscape ? 1 : 0);
      // The reports at 2 s and 5 s after the open, and the 15 s report.
      expect(mockedRequestAPI).toHaveBeenCalledTimes(restore ? 3 : 0);
      expect(jest.getTimerCount()).toBe(restore ? 1 : 0);
    }
  );

  it('keeps the plugin ids, the token lists and the terminal schema keys (ACC-PATCH-51)', () => {
    const schema = require('../../schema/plugin.json');
    for (const key of [
      CPR_ESCAPE_SWITCH,
      RESTORE_SWITCH,
      'redrawBackgroundTerminals'
    ]) {
      expect(schema.properties[key]).toMatchObject({
        type: 'boolean',
        default: true
      });
    }
    expect(cprEscapePlugin.id).toBe(
      '@stellarshenson/jupyterlab-core-patches-extension:terminal-cpr-escape'
    );
    expect(cprEscapePlugin.requires).toBeUndefined();
    expect(cprEscapePlugin.optional).toEqual([
      ITerminalTracker,
      ISettingRegistry
    ]);
    expect(restorePlugin.id).toBe(
      '@stellarshenson/jupyterlab-core-patches-extension:restore-terminals'
    );
    expect(restorePlugin.requires).toEqual([ITerminalTracker]);
    expect(restorePlugin.optional).toEqual([ISettingRegistry]);
  });

  it('installs each page listener and the 15 s interval once with both plugins on (ACC-PATCH-52)', async () => {
    const { tracker, fire } = createTracker();
    const registry = createRegistry(true, true);
    await activateBoth(tracker, registry);
    // A second activation of each plugin on the same page; the restore
    // window guard is cleared so the module's own once-per-page holds.
    delete (window as any)[PATCH_MARKER];
    await activateBoth(tracker, registry, 'restore first');

    expect(listeners('visibilitychange')).toBe(1);
    expect(listeners('online')).toBe(1);
    expect(jest.getTimerCount()).toBe(1);

    fire({ content: fakeTerminal().terminal });
    expect(jest.getTimerCount()).toBe(1 + OPEN_REPORT_DELAYS_MS.length);

    jest.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(mockedRequestAPI).toHaveBeenCalledTimes(3);
  });

  it('installs no page listener and no timer with both plugins off (ACC-PATCH-52)', async () => {
    const { tracker, fire } = createTracker();
    await activateBoth(tracker, createRegistry(false, false));
    fire({ content: fakeTerminal().terminal });

    expect(listeners('visibilitychange')).toBe(0);
    expect(listeners('online')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
