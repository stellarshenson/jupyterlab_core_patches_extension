import { JupyterFrontEnd } from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { Signal } from '@lumino/signaling';

import plugin from '../fixes/terminal-cpr-escape';
import { holdUntilOpened } from '../fixes/terminal-cpr-escape/unopenedTerminal';

/**
 * The size JupyterLab reports for an xterm that was never opened.
 */
const UNFITTED_SIZE = { type: 'set_size', content: [24, 80, 903, 1522] };

/**
 * The size of the fitted xterm, read from the source test.
 */
const FITTED_SIZE = { type: 'set_size', content: [63, 177, 903, 1270] };

/**
 * A message the shell receives as typed input.
 */
const STDIN = { type: 'stdin', content: ['ls\r'] };

/**
 * History output sent by the server.
 */
const STDOUT = { type: 'stdout', content: ['history'] };

/**
 * One registered `widgetAdded` handler.
 */
type WidgetAddedHandler = (sender: unknown, widget: unknown) => void;

/**
 * The parts of the terminal widget that `holdUntilOpened` uses, in a hidden
 * tab.
 */
function fakeTerminal(refresh = jest.fn(() => Promise.resolve())) {
  const send = jest.fn();
  const session: any = { send };
  session.messageReceived = new Signal<any, any>(session);
  const terminal: any = {
    node: document.createElement('div'),
    session,
    refresh,
    isVisible: false
  };
  terminal.disposed = new Signal<any, void>(terminal);
  return { terminal, send, refresh };
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
 * them on demand.
 */
function createTracker(): {
  tracker: ITerminalTracker;
  fire: (widget: unknown) => void;
  connections: () => number;
} {
  const handlers: WidgetAddedHandler[] = [];
  const tracker = {
    widgetAdded: {
      connect: (handler: WidgetAddedHandler): WidgetAddedHandler => {
        handlers.push(handler);
        return handler;
      }
    }
  } as unknown as ITerminalTracker;
  return {
    tracker,
    fire: widget => handlers.forEach(handler => handler(null, widget)),
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
 * Activate the plugin against the stand-in tracker and registry.
 */
async function activate(
  tracker: ITerminalTracker,
  registry: ISettingRegistry | null = null
): Promise<void> {
  await plugin.activate({} as JupyterFrontEnd, tracker, registry);
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
    terminal.session.messageReceived.emit(STDOUT);
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
    const { terminal, refresh } = fakeTerminal();
    first.fire({ content: terminal });
    second.fire({ content: terminal });

    terminal.session.messageReceived.emit(STDOUT);
    open(terminal);
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('holdUntilOpened', () => {
  it('refreshes exactly once when stdout arrived before the open', async () => {
    const { terminal, refresh } = fakeTerminal();
    holdUntilOpened(terminal, () => true);

    terminal.session.messageReceived.emit(STDOUT);
    open(terminal);
    await flush();
    terminal.node.appendChild(document.createElement('div'));
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when stdout arrived while the terminal was visible', async () => {
    const { terminal, refresh } = fakeTerminal();
    terminal.isVisible = true;
    holdUntilOpened(terminal, () => true);

    terminal.session.messageReceived.emit(STDOUT);
    open(terminal);
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not refresh when no stdout arrived before the open', async () => {
    const { terminal, refresh } = fakeTerminal();
    holdUntilOpened(terminal, () => true);

    open(terminal);
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('holds back a set_size and passes a stdin before the open', () => {
    const { terminal, send } = fakeTerminal();
    holdUntilOpened(terminal, () => true);

    terminal.session.send(UNFITTED_SIZE);
    terminal.session.send(STDIN);

    expect(send.mock.calls).toEqual([[STDIN]]);
    expect(send.mock.contexts[0]).toBe(terminal.session);
  });

  it('passes a set_size sent right after the xterm element is appended', () => {
    const { terminal, send } = fakeTerminal();
    holdUntilOpened(terminal, () => true);

    // no await between the two: the observer callback has not run yet
    open(terminal);
    terminal.session.send(FITTED_SIZE);

    expect(send.mock.calls).toEqual([[FITTED_SIZE]]);
  });

  it('puts the original send back after the open', async () => {
    const { terminal, send } = fakeTerminal();
    holdUntilOpened(terminal, () => true);
    expect(terminal.session.send).not.toBe(send);

    open(terminal);
    await flush();

    expect(terminal.session.send).toBe(send);
  });

  it('holds nothing back and refreshes nothing when isEnabled is false', async () => {
    const { terminal, send, refresh } = fakeTerminal();
    holdUntilOpened(terminal, () => false);

    terminal.session.send(UNFITTED_SIZE);
    terminal.session.messageReceived.emit(STDOUT);
    open(terminal);
    await flush();

    expect(send.mock.calls).toEqual([[UNFITTED_SIZE]]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('leaves a terminal that is already opened untouched', async () => {
    const { terminal, send, refresh } = fakeTerminal();
    open(terminal);
    holdUntilOpened(terminal, () => true);

    expect(terminal.session.send).toBe(send);
    terminal.session.messageReceived.emit(STDOUT);
    terminal.node.appendChild(document.createElement('div'));
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });

  // jest fails a test during which a promise rejection stays unhandled
  it('catches a rejected refresh', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const reason = new Error('reconnect failed');
    const { terminal } = fakeTerminal(jest.fn(() => Promise.reject(reason)));
    holdUntilOpened(terminal, () => true);

    terminal.session.messageReceived.emit(STDOUT);
    open(terminal);
    await flush();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toContain(reason);
    warn.mockRestore();
  });

  it('puts send back on disposal before the open and does not refresh at a later open', async () => {
    const { terminal, send, refresh } = fakeTerminal();
    holdUntilOpened(terminal, () => true);

    terminal.session.messageReceived.emit(STDOUT);
    terminal.disposed.emit();
    expect(terminal.session.send).toBe(send);
    open(terminal);
    await flush();

    expect(refresh).not.toHaveBeenCalled();
  });

  it('is a no-op when the same terminal is held a second time', async () => {
    const { terminal, send, refresh } = fakeTerminal();
    holdUntilOpened(terminal, () => true);
    holdUntilOpened(terminal, () => true);

    terminal.session.messageReceived.emit(STDOUT);
    open(terminal);
    await flush();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(terminal.session.send).toBe(send);
  });
});
