import { JupyterFrontEnd } from '@jupyterlab/application';
import { ServerConnection } from '@jupyterlab/services';
import { TerminalConnection } from '@jupyterlab/services/lib/terminal/default';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { Signal } from '@lumino/signaling';

import plugin from '../fixes/terminal-cpr-escape';

/**
 * The size JupyterLab reports for an xterm that was never opened.
 */
const UNFITTED_SIZE = { type: 'set_size', content: [24, 80, 903, 1522] };

/**
 * The size of the fitted xterm, read from the source test.
 */
const FITTED_SIZE = { type: 'set_size', content: [63, 177, 903, 1270] };

/**
 * The size the patch sends one column narrower before restoring the fitted
 * size, so the PTY changes and the program repaints.
 */
const STEPPED_SIZE = { type: 'set_size', content: [63, 176, 903, 1270] };

/**
 * A message the shell receives as typed input.
 */
const STDIN = { type: 'stdin', content: ['ls\r'] };

/**
 * The session name of a terminal that was running when the page loaded.
 */
const RESTORED_NAME = '1';

/**
 * One registered `widgetAdded` handler.
 */
type WidgetAddedHandler = (sender: unknown, widget: unknown) => void;

/**
 * The parts of the terminal widget that the `send` wrapper uses, in a hidden
 * tab. `refresh` is present so a test can assert the patch never reconnects
 * the session at the first open. `reconnect` turns the status `connecting` at
 * once, as the stock session does.
 */
function fakeTerminal(name = RESTORED_NAME, connectionStatus = 'connected') {
  const send = jest.fn();
  const refresh = jest.fn(() => Promise.resolve());
  const fit = jest.fn();
  const processMessage = jest.fn();
  const session: any = { send, name, connectionStatus, isDisposed: false };
  session.connectionStatusChanged = new Signal<any, string>(session);
  const reconnect = jest.fn(() => {
    session.connectionStatus = 'connecting';
    return Promise.resolve();
  });
  session.reconnect = reconnect;
  const terminal: any = {
    node: document.createElement('div'),
    session,
    refresh,
    fit,
    processMessage
  };
  terminal.disposed = new Signal<any, void>(terminal);
  return { terminal, send, refresh, reconnect, fit, processMessage };
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
 * Let the MutationObserver callback and the promise handlers run.
 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

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
 * A settings registry stand-in. The patch switch reads `enabled`; the
 * `redrawBackgroundTerminals` option reads `redrawBackground`.
 */
function createRegistry(
  enabled: boolean,
  redrawBackground = true
): ISettingRegistry {
  return {
    load: async () => ({
      get: (key: string) => ({
        composite:
          key === 'redrawBackgroundTerminals' ? redrawBackground : enabled
      })
    })
  } as unknown as ISettingRegistry;
}

/**
 * An app stand-in whose terminal manager lists `names` as the sessions running
 * when the page loaded. `change` emits a new running list, as a poll does.
 */
function createApp(names: string[] = [RESTORED_NAME]): {
  app: JupyterFrontEnd;
  change: (names: string[]) => void;
} {
  const runningChanged = new Signal<object, { name: string }[]>({});
  const terminals = {
    ready: Promise.resolve(),
    running: () => names.map(name => ({ name }))[Symbol.iterator](),
    runningChanged
  };
  return {
    app: { serviceManager: { terminals } } as unknown as JupyterFrontEnd,
    change: next => runningChanged.emit(next.map(name => ({ name })))
  };
}

/**
 * Activate the plugin against the stand-in app, tracker and registry.
 */
async function activate(
  tracker: ITerminalTracker,
  registry: ISettingRegistry | null = null,
  app: JupyterFrontEnd = createApp().app
): Promise<void> {
  await plugin.activate(app, tracker, registry);
}

/**
 * Fire `terminal` through the tracker, show it and send the fitted size; the
 * sizes the session sent, including the restore after the step pause.
 */
function showThroughPlugin(
  fire: (widget: unknown) => void,
  name: string
): unknown[][] {
  jest.useFakeTimers();
  try {
    const { terminal, send } = fakeTerminal(name);
    fire({ content: terminal });
    terminal.session.send(UNFITTED_SIZE);
    open(terminal);
    terminal.session.send(FITTED_SIZE);
    jest.advanceTimersByTime(120);
    return send.mock.calls;
  } finally {
    jest.useRealTimers();
  }
}

describe('terminal CPR escape plugin', () => {
  it('skips the patch when its switch is off', async () => {
    const { tracker, connections } = createTracker();
    await activate(tracker, createRegistry(false));

    expect(connections()).toBe(0);
  });

  it('connects to the terminal tracker when its switch is on', async () => {
    const { tracker, connections } = createTracker();
    await activate(tracker, createRegistry(true));

    expect(connections()).toBe(1);
  });

  it('leaves the terminal to JupyterLab when redrawBackgroundTerminals is off', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true, false));
    await flush();
    const { terminal, send, refresh } = fakeTerminal();
    fire({ content: terminal });

    terminal.session.send(UNFITTED_SIZE);
    open(terminal);
    await flush();

    expect(send.mock.calls).toEqual([[UNFITTED_SIZE]]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('holds one terminal once when it is activated twice', async () => {
    const first = createTracker();
    const second = createTracker();
    await activate(first.tracker, createRegistry(true));
    await activate(second.tracker, createRegistry(true));
    const { terminal, send, refresh } = fakeTerminal();
    first.fire({ content: terminal });
    second.fire({ content: terminal });

    terminal.session.send(UNFITTED_SIZE);
    expect(send).not.toHaveBeenCalled();

    open(terminal);
    terminal.session.send(FITTED_SIZE);

    expect(send.mock.calls).toEqual([[FITTED_SIZE], [STEPPED_SIZE]]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('steps a session that was running when the page loaded', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));

    expect(showThroughPlugin(fire, RESTORED_NAME)).toEqual([
      [FITTED_SIZE],
      [STEPPED_SIZE],
      [FITTED_SIZE]
    ]);
  });

  it('steps a restored session that is still connecting when the hold releases', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    jest.useFakeTimers();
    try {
      const { terminal, send } = fakeTerminal(RESTORED_NAME, 'connecting');
      fire({ content: terminal });
      terminal.session.send(UNFITTED_SIZE);
      open(terminal);
      terminal.session.send(FITTED_SIZE);

      expect(send.mock.calls).toEqual([[FITTED_SIZE], [STEPPED_SIZE]]);
      jest.advanceTimersByTime(120);
      expect(send.mock.calls).toEqual([
        [FITTED_SIZE],
        [STEPPED_SIZE],
        [FITTED_SIZE]
      ]);

      terminal.session.connectionStatus = 'connected';
      terminal.session.connectionStatusChanged.emit('connected');

      expect(send.mock.calls).toEqual([
        [FITTED_SIZE],
        [STEPPED_SIZE],
        [FITTED_SIZE]
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends only the fitted size for a session the page started new', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));

    expect(showThroughPlugin(fire, '2')).toEqual([[FITTED_SIZE]]);
  });

  it('gives no step to a new session that reuses the name of a closed one', async () => {
    const { tracker, fire } = createTracker();
    const { app, change } = createApp();
    await activate(tracker, createRegistry(true), app);
    change([]);
    change([RESTORED_NAME]);

    expect(showThroughPlugin(fire, RESTORED_NAME)).toEqual([[FITTED_SIZE]]);
  });

  it('steps the fitted size when an open terminal is shown (ACC-PATCH-64)', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    jest.useFakeTimers();
    try {
      const { terminal, send, fit } = fakeTerminal();
      fire({ content: terminal });
      terminal.session.send(UNFITTED_SIZE);
      open(terminal);
      terminal.session.send(FITTED_SIZE);
      jest.advanceTimersByTime(120);
      send.mockClear();

      terminal.processMessage({ type: 'after-show' });
      expect(fit).toHaveBeenCalledTimes(1);
      terminal.session.send(FITTED_SIZE);

      expect(send.mock.calls).toEqual([[FITTED_SIZE], [STEPPED_SIZE]]);
      jest.advanceTimersByTime(120);
      expect(send.mock.calls).toEqual([
        [FITTED_SIZE],
        [STEPPED_SIZE],
        [FITTED_SIZE]
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not step a terminal whose xterm was never opened (ACC-PATCH-64)', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    jest.useFakeTimers();
    try {
      const { terminal, send } = fakeTerminal();
      fire({ content: terminal });
      terminal.session.send(UNFITTED_SIZE);
      terminal.processMessage({ type: 'after-show' });
      terminal.session.send(UNFITTED_SIZE);
      expect(send).not.toHaveBeenCalled();

      open(terminal);
      terminal.session.send(FITTED_SIZE);

      expect(send.mock.calls).toEqual([[FITTED_SIZE], [STEPPED_SIZE]]);
      jest.advanceTimersByTime(120);
      expect(send.mock.calls).toEqual([
        [FITTED_SIZE],
        [STEPPED_SIZE],
        [FITTED_SIZE]
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends no show or reconnect step while redrawBackgroundTerminals is off (ACC-PATCH-64, ACC-PATCH-65)', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true, false));
    jest.useFakeTimers();
    try {
      const { terminal, send, fit, reconnect } = fakeTerminal('2', 'connected');
      open(terminal);
      fire({ content: terminal });
      terminal.session.send(FITTED_SIZE);
      send.mockClear();

      terminal.processMessage({ type: 'after-show' });
      terminal.session.send(FITTED_SIZE);
      terminal.session.connectionStatus = 'disconnected';
      setVisibility('visible');
      expect(reconnect).toHaveBeenCalledTimes(1);
      terminal.session.connectionStatus = 'connected';
      terminal.session.connectionStatusChanged.emit('connected');

      expect(fit).not.toHaveBeenCalled();
      expect(send.mock.calls).toEqual([[FITTED_SIZE]]);
    } finally {
      jest.useRealTimers();
    }
  });
});

/**
 * Set `document.visibilityState` and fire `visibilitychange`, as a browser
 * does when the page is hidden or shown again.
 */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

/**
 * Fire the event the browser sends when the network comes back.
 */
function goOnline(): void {
  window.dispatchEvent(new Event('online'));
}

/**
 * A websocket stand-in for the stock `TerminalConnection`. Every socket the
 * connection opens lands in `sockets`; a test drives `onmessage` and
 * `onclose` by hand.
 */
class FakeSocket {
  static sockets: FakeSocket[] = [];
  readonly sent: string[] = [];
  onmessage: (event: { data: string }) => void = () => undefined;
  onclose: (event: { code: number }) => void = () => undefined;
  onerror: (event: { code: number }) => void = () => undefined;

  constructor(readonly url: string) {
    FakeSocket.sockets.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    // The connection clears the handlers before it closes a socket.
  }
}

/**
 * A stock `TerminalConnection` on `FakeSocket` that JupyterLab gave up on:
 * the first socket connects, then every retry closes until the status is
 * `disconnected`. Needs fake timers for the retry delays.
 */
function givenUpConnection(): TerminalConnection {
  FakeSocket.sockets = [];
  const connection = new TerminalConnection({
    model: { name: RESTORED_NAME },
    serverSettings: ServerConnection.makeSettings({
      wsUrl: 'ws://localhost/',
      WebSocket: FakeSocket as unknown as typeof WebSocket
    })
  });
  FakeSocket.sockets[0].onmessage({ data: '["setup", {}]' });
  expect(connection.connectionStatus).toBe('connected');
  for (let attempt = 0; attempt < 10; attempt++) {
    if (connection.connectionStatus === 'disconnected') {
      break;
    }
    FakeSocket.sockets[FakeSocket.sockets.length - 1].onclose({ code: 1006 });
    jest.runOnlyPendingTimers();
  }
  expect(connection.connectionStatus).toBe('disconnected');
  return connection;
}

describe('terminal reconnect', () => {
  it('reconnects a disconnected terminal when the page becomes visible', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const { terminal, reconnect } = fakeTerminal('2', 'disconnected');
    fire({ content: terminal });

    setVisibility('hidden');
    expect(reconnect).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('reconnects a disconnected terminal when the browser fires online', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const { terminal, reconnect } = fakeTerminal('2', 'disconnected');
    fire({ content: terminal });

    goOnline();

    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('steps the fitted size when the connection opens after a drop (ACC-PATCH-65)', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    jest.useFakeTimers();
    try {
      const { terminal, send, reconnect } = fakeTerminal('2', 'connected');
      open(terminal);
      fire({ content: terminal });
      terminal.session.send(FITTED_SIZE);
      send.mockClear();

      terminal.session.connectionStatus = 'disconnected';
      setVisibility('visible');
      expect(reconnect).toHaveBeenCalledTimes(1);
      terminal.session.connectionStatus = 'connected';
      terminal.session.connectionStatusChanged.emit('connected');

      expect(send.mock.calls).toEqual([[STEPPED_SIZE]]);
      jest.advanceTimersByTime(120);
      expect(send.mock.calls).toEqual([[STEPPED_SIZE], [FITTED_SIZE]]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not step the first connection of a session (ACC-PATCH-65)', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    jest.useFakeTimers();
    try {
      const { terminal, send } = fakeTerminal('2', 'connecting');
      open(terminal);
      fire({ content: terminal });
      terminal.session.send(FITTED_SIZE);
      send.mockClear();

      terminal.session.connectionStatus = 'connected';
      terminal.session.connectionStatusChanged.emit('connected');

      expect(send).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reconnects on typed input and sends it after the connection opens, in typed order', async () => {
    jest.useFakeTimers();
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const connection = givenUpConnection();
      const reconnect = jest.spyOn(connection, 'reconnect');
      const { tracker, fire } = createTracker();
      await activate(tracker, createRegistry(true));
      const { terminal } = fakeTerminal('2', 'disconnected');
      terminal.session = connection;
      fire({ content: terminal });
      const opened = FakeSocket.sockets.length;

      connection.send({ type: 'stdin', content: ['l'] });
      connection.send({ type: 'stdin', content: ['s'] });
      expect(reconnect).toHaveBeenCalledTimes(1);
      expect(connection.connectionStatus).toBe('connecting');

      jest.runOnlyPendingTimers();
      expect(FakeSocket.sockets).toHaveLength(opened + 1);
      const socket = FakeSocket.sockets[opened];
      expect(socket.sent).toEqual([]);

      socket.onmessage({ data: '["setup", {}]' });

      expect(connection.connectionStatus).toBe('connected');
      expect(socket.sent).toEqual(['["stdin","l"]', '["stdin","s"]']);
      connection.dispose();
    } finally {
      warn.mockRestore();
      error.mockRestore();
      jest.useRealTimers();
    }
  });

  it('keeps the typing trigger after the hold releases send', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const { terminal, send, reconnect } = fakeTerminal('2', 'disconnected');
    fire({ content: terminal });

    terminal.session.send(STDIN);
    expect(reconnect).toHaveBeenCalledTimes(1);

    open(terminal);
    await flush();
    terminal.session.connectionStatus = 'disconnected';
    terminal.session.send(STDIN);

    expect(reconnect).toHaveBeenCalledTimes(2);
    expect(send.mock.calls).toEqual([[STDIN], [STDIN]]);
  });

  it('wraps send once when the plugin is activated twice', async () => {
    const first = createTracker();
    const second = createTracker();
    await activate(first.tracker, createRegistry(true));
    await activate(second.tracker, createRegistry(true));
    const { terminal, send, reconnect } = fakeTerminal('2', 'disconnected');
    // A reconnect that leaves the status disconnected: a second wrapper on
    // the session would call it a second time for one keystroke.
    reconnect.mockImplementation(() => Promise.resolve());
    first.fire({ content: terminal });
    second.fire({ content: terminal });

    terminal.session.send(STDIN);

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([[STDIN]]);
  });

  it('leaves a connected, connecting or disposed terminal alone', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const connected = fakeTerminal('2', 'connected');
    const connecting = fakeTerminal('3', 'connecting');
    const disposed = fakeTerminal('4', 'disconnected');
    disposed.terminal.session.isDisposed = true;
    const all = [connected, connecting, disposed];
    all.forEach(({ terminal }) => fire({ content: terminal }));

    setVisibility('visible');
    goOnline();
    all.forEach(({ terminal }) => terminal.session.send(STDIN));

    all.forEach(({ reconnect }) => expect(reconnect).not.toHaveBeenCalled());
  });

  it('starts one reconnect for triggers that arrive together', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const { terminal, send, reconnect } = fakeTerminal('2', 'disconnected');
    fire({ content: terminal });

    setVisibility('visible');
    goOnline();
    terminal.session.send(STDIN);

    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([[STDIN]]);
  });

  it('adds no listener and reconnects nothing when the switch is off', async () => {
    const documentListener = jest.spyOn(document, 'addEventListener');
    const windowListener = jest.spyOn(window, 'addEventListener');
    try {
      const { tracker, fire } = createTracker();
      await activate(tracker, createRegistry(false));
      const { terminal, reconnect } = fakeTerminal('2', 'disconnected');
      fire({ content: terminal });

      setVisibility('visible');
      goOnline();
      terminal.session.send(STDIN);

      expect(documentListener).not.toHaveBeenCalledWith(
        'visibilitychange',
        expect.anything()
      );
      expect(windowListener).not.toHaveBeenCalledWith(
        'online',
        expect.anything()
      );
      expect(reconnect).not.toHaveBeenCalled();
    } finally {
      documentListener.mockRestore();
      windowListener.mockRestore();
    }
  });
});

describe('terminal size hold through the plugin', () => {
  it('does not reconnect the session at the first open', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const { terminal, refresh } = fakeTerminal();
    fire({ content: terminal });

    open(terminal);
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('holds a set_size until the xterm opens, then steps the PTY once', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    jest.useFakeTimers();
    try {
      const { terminal, send } = fakeTerminal();
      fire({ content: terminal });

      terminal.session.send(UNFITTED_SIZE);
      expect(send).not.toHaveBeenCalled();

      open(terminal);
      terminal.session.send(FITTED_SIZE);

      expect(send.mock.calls).toEqual([[FITTED_SIZE], [STEPPED_SIZE]]);
      jest.advanceTimersByTime(120);
      expect(send.mock.calls).toEqual([
        [FITTED_SIZE],
        [STEPPED_SIZE],
        [FITTED_SIZE]
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('holds back a set_size and passes a stdin before the open', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const { terminal, send } = fakeTerminal();
    fire({ content: terminal });

    terminal.session.send(UNFITTED_SIZE);
    terminal.session.send(STDIN);

    expect(send.mock.calls).toEqual([[STDIN]]);
    expect(send.mock.contexts[0]).toBe(terminal.session);
  });

  it('passes a set_size sent right after the xterm element is appended', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const { terminal, send } = fakeTerminal();
    fire({ content: terminal });

    // no await between the two: the observer callback has not run yet
    open(terminal);
    terminal.session.send(FITTED_SIZE);

    expect(send.mock.calls).toEqual([[FITTED_SIZE], [STEPPED_SIZE]]);
  });

  it('leaves a terminal that is already opened unstepped', async () => {
    const { tracker, fire } = createTracker();
    await activate(tracker, createRegistry(true));
    const { terminal, send, refresh } = fakeTerminal();
    open(terminal);
    fire({ content: terminal });

    terminal.session.send(FITTED_SIZE);

    expect(send.mock.calls).toEqual([[FITTED_SIZE]]);
    expect(refresh).not.toHaveBeenCalled();
  });
});
