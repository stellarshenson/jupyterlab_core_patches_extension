import type { Terminal } from '@jupyterlab/services';
import type { ITerminal, ITerminalTracker } from '@jupyterlab/terminal';

/**
 * The interval between periodic terminal-folder reports, in milliseconds.
 */
export const POLL_INTERVAL_MS = 15000;

/**
 * The delays after a terminal opens at which the folder report is retried, in
 * milliseconds. The first report can run before the terminal's pty exists.
 */
export const OPEN_REPORT_DELAYS_MS = [2000, 5000];

/**
 * Pause between the two steps that make the program repaint at the fitted
 * size. Matches the server's `_BOUNCE_STEP`.
 */
const BOUNCE_STEP = 120;

/**
 * The part of the terminal CPR escape patch: the size hold of a background
 * terminal and the reconnect of a terminal that JupyterLab gave up on.
 */
export interface ICprEscapePart {
  /**
   * Read at each decision; false leaves the size of a background terminal to
   * JupyterLab. The plugin reads `redrawBackgroundTerminals`.
   */
  isEnabled: () => boolean;
  /**
   * Read at the first fitted size; true for a session that was running when
   * the page loaded, false for a session the page started new.
   */
  isRestored: (name: string) => boolean;
}

/**
 * The part of the restore terminals patch: the terminal-folder reports.
 */
export interface IRestorePart {
  /**
   * Report the names of the tracker's terminals to the server.
   */
  report: () => void;
}

/**
 * The size hold that the `send` wrapper of one session carries until the
 * xterm opens.
 */
interface ISizeHold {
  /**
   * The terminal widget whose xterm is not opened yet.
   */
  terminal: ITerminal.ITerminal;
  /**
   * Read at each decision; false leaves the terminal to JupyterLab.
   */
  isEnabled: () => boolean;
  /**
   * Read at the first fitted size; false sends that size without the step.
   */
  isRestored: () => boolean;
}

/**
 * The parts registered on one terminal tracker.
 */
interface IParts {
  /**
   * The terminal CPR escape part, or null while its plugin has not registered.
   */
  cprEscape: ICprEscapePart | null;
  /**
   * The restore terminals part, or null while its plugin has not registered.
   */
  restore: IRestorePart | null;
}

/**
 * The parts registered on each terminal tracker. A page has one terminal
 * tracker, so the one `widgetAdded` handler and each page listener and timer
 * are installed once per page.
 */
const trackers = new WeakMap<ITerminalTracker, IParts>();

/**
 * Sessions that carry the one `send` wrapper. A second call for the same
 * session returns before it wraps `send` again, so one message never runs
 * two wrappers.
 */
const wrappedSessions = new WeakSet<Terminal.ITerminalConnection>();

/**
 * True once xterm.js has appended its element, of class `.xterm`, in
 * `Terminal.open()`.
 *
 * @param terminal - The terminal widget
 */
function isOpened(terminal: ITerminal.ITerminal): boolean {
  return terminal.node.querySelector('.xterm') !== null;
}

/**
 * Reconnect a terminal session that JupyterLab gave up on.
 *
 * After a websocket closes, JupyterLab retries 7 times with a random delay of
 * up to 2^n-1 seconds, then sets the status `disconnected` and never tries
 * again. The tab keeps its last screen, and typed input waits in the session
 * queue. `reconnect()` starts the retries again; the status turns
 * `connecting` at once, so a second trigger that arrives before the socket
 * opens starts nothing. The queued input goes out when the connection opens.
 *
 * @param session - The terminal session. A session that is connected,
 * connecting or disposed is left alone
 */
function reconnectIfGivenUp(session: Terminal.ITerminalConnection): void {
  if (session.isDisposed || session.connectionStatus !== 'disconnected') {
    return;
  }
  // Rejects when the new retries give up too; the next trigger tries again.
  session.reconnect().catch(() => undefined);
}

/**
 * Install the one `send` wrapper of a terminal session.
 *
 * The wrapper carries the typing reconnect, the size hold and the repaint
 * step on a show or a reconnect. A `stdin` message runs `reconnectIfGivenUp`,
 * then goes on, and the original `send` queues it until the connection opens.
 * With `hold`, the wrapper also keeps a terminal whose xterm is not opened yet
 * from reporting its size, then steps the PTY once so the running program
 * repaints at the fitted size.
 *
 * JupyterLab opens and fits the xterm only when the terminal's tab is visible.
 * Until then the xterm is 80x24: the widget reports that size to the server
 * and the PTY shrinks to it. Holding back `set_size` keeps the PTY at its real
 * size. Once the xterm opens, the widget sends the fitted size, and the hold
 * sets the PTY one column narrower and back: terminado resizes the PTY only
 * when the size differs, and a restored terminal in an unchanged layout
 * already has the fitted size, so the fitted size alone sends no SIGWINCH and
 * the program never repaints. The hold releases at the first append of the
 * xterm element or at the disposal of the terminal; the wrapper then passes
 * every message on.
 *
 * The wrapper records the content of every `set_size` it forwards. With
 * `hold`, it also steps when the terminal is shown or when the connection
 * opens after a drop: a show asks the widget to refit and steps the size the
 * widget sends next, and a connection that opens after a drop steps the last
 * recorded size. Both triggers are installed for the session's life and
 * removed at the terminal's disposal.
 *
 * A second call for the same session returns at once.
 *
 * @param session - The terminal session
 * @param hold - The size hold; absent for no hold
 */
function wrapSend(
  session: Terminal.ITerminalConnection,
  hold?: ISizeHold
): void {
  if (wrappedSessions.has(session)) {
    return;
  }
  /**
   * The hold while the xterm is not opened; null once it released.
   */
  let held = hold && !isOpened(hold.terminal) ? hold : null;
  wrappedSessions.add(session);

  const send = session.send;

  /**
   * The content of the last `set_size` the wrapper forwarded.
   */
  let recorded: number[] | null = null;
  /**
   * True between a show of the terminal and the next forwarded `set_size`.
   */
  let arm = false;

  /**
   * Step the PTY one column narrower and back after `BOUNCE_STEP`, so the
   * program repaints at `size`. No step while the hold is active: the hold
   * owns the first show.
   */
  const step = (size: number[] | null, requireConnected = true) => {
    if (
      !size ||
      size[0] <= 0 ||
      size[1] <= 0 ||
      !hold ||
      !hold.isEnabled() ||
      hold.terminal.isDisposed ||
      !isOpened(hold.terminal) ||
      (requireConnected && session.connectionStatus !== 'connected') ||
      held !== null
    ) {
      return;
    }
    const [rows, cols, height, width] = size;
    // terminado resizes the PTY only when the size differs, so the fitted
    // size alone leaves a terminal without SIGWINCH. Step one column
    // narrower and back so the program repaints at the fitted size.
    send.call(session, {
      type: 'set_size',
      content: [rows, cols - 1, height, width]
    });
    setTimeout(() => {
      // A restore after a second drop waits for the next socket.
      if (
        !hold.terminal.isDisposed &&
        (!requireConnected || session.connectionStatus === 'connected')
      ) {
        send.call(session, {
          type: 'set_size',
          content: [rows, cols, height, width]
        });
      }
    }, BOUNCE_STEP);
  };

  session.send = (message: Terminal.IMessage) => {
    if (message.type === 'stdin') {
      reconnectIfGivenUp(session);
    }
    // Opened is read at call time: the widget sends the fitted size right
    // after it opens the xterm, before the observer runs.
    if (
      held &&
      message.type === 'set_size' &&
      !isOpened(held.terminal) &&
      held.isEnabled()
    ) {
      return;
    }
    send.call(session, message);
    if (message.type === 'set_size' && message.content) {
      const content = message.content as number[];
      recorded = content;
      if (arm) {
        arm = false;
        step(content);
      }
    }
    if (!held) {
      return;
    }
    const { isEnabled, isRestored } = held;
    if (
      message.type !== 'set_size' ||
      !message.content ||
      !isEnabled() ||
      !isRestored()
    ) {
      return;
    }
    // Release first: step() does nothing while the hold is active.
    release();
    step(recorded, false);
  };

  if (!hold) {
    return;
  }
  const terminal = hold.terminal;
  const processMessage = terminal.processMessage;
  /**
   * Refit at a show, then step the size the widget sends next.
   */
  terminal.processMessage = msg => {
    processMessage.call(terminal, msg);
    if (msg.type === 'after-show' && hold.isEnabled()) {
      terminal.fit();
      arm = true;
    }
  };
  /**
   * True once the session has reported a connection, so the first connection
   * of a session is not stepped.
   */
  let hadConnected = session.connectionStatus === 'connected';
  const onStatus = (_: unknown, status: Terminal.ConnectionStatus) => {
    if (status !== 'connected') {
      return;
    }
    if (hadConnected) {
      step(recorded);
    } else {
      hadConnected = true;
    }
  };
  session.connectionStatusChanged.connect(onStatus);
  terminal.disposed.connect(() => {
    session.connectionStatusChanged.disconnect(onStatus);
    terminal.processMessage = processMessage;
  });

  if (!held) {
    return;
  }
  /**
   * End the hold and disconnect the observer.
   */
  const release = () => {
    held = null;
    terminal.disposed.disconnect(release);
    observer.disconnect();
  };
  /**
   * Release at the first append of the xterm element.
   */
  const observer = new MutationObserver(() => {
    if (isOpened(terminal)) {
      release();
    }
  });
  terminal.disposed.connect(release);
  observer.observe(terminal.node, { childList: true });
}

/**
 * Return the parts registered on `tracker`. The first call for a tracker
 * connects its one `widgetAdded` handler, which serves the parts registered
 * when a terminal is added: the CPR escape part wraps the session's `send`
 * once with the typing reconnect and the size hold, and the restore part
 * reports the terminal folders at each delay of `OPEN_REPORT_DELAYS_MS`.
 *
 * @param tracker - The terminal tracker of the page
 */
function partsOf(tracker: ITerminalTracker): IParts {
  const known = trackers.get(tracker);
  if (known) {
    return known;
  }
  const parts: IParts = { cprEscape: null, restore: null };
  tracker.widgetAdded.connect((_, widget) => {
    const { cprEscape, restore } = parts;
    if (cprEscape) {
      const name = widget.content.session.name;
      wrapSend(widget.content.session, {
        terminal: widget.content,
        isEnabled: cprEscape.isEnabled,
        isRestored: () => cprEscape.isRestored(name)
      });
    }
    if (restore) {
      // Report shortly after a terminal opens (retry for pty spawn lag).
      for (const delay of OPEN_REPORT_DELAYS_MS) {
        setTimeout(restore.report, delay);
      }
    }
  });
  trackers.set(tracker, parts);
  return parts;
}

/**
 * Register the terminal CPR escape part on the page's terminal tracker.
 *
 * Each terminal added from now on gets the size hold and the typing
 * reconnect in one `send` wrapper. Adds the `visibilitychange` listener on
 * `document` and the `online` listener on `window`, which reconnect every
 * tracked terminal that JupyterLab gave up on. A second registration on the
 * same tracker does nothing.
 *
 * @param tracker - The terminal tracker of the page
 * @param part - The CPR escape part
 */
export function registerCprEscape(
  tracker: ITerminalTracker,
  part: ICprEscapePart
): void {
  const parts = partsOf(tracker);
  if (parts.cprEscape) {
    return;
  }
  parts.cprEscape = part;
  /**
   * Reconnect every tracked terminal that JupyterLab gave up on.
   */
  const reconnectAll = () =>
    tracker.forEach(widget => reconnectIfGivenUp(widget.content.session));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      reconnectAll();
    }
  });
  window.addEventListener('online', reconnectAll);
}

/**
 * Register the restore terminals part on the page's terminal tracker.
 *
 * Each terminal added from now on is followed by a folder report at each
 * delay of `OPEN_REPORT_DELAYS_MS`, and a report runs every
 * `POLL_INTERVAL_MS`. A second registration on the same tracker does nothing.
 *
 * @param tracker - The terminal tracker of the page
 * @param part - The restore part
 */
export function registerRestore(
  tracker: ITerminalTracker,
  part: IRestorePart
): void {
  const parts = partsOf(tracker);
  if (parts.restore) {
    return;
  }
  parts.restore = part;
  // Periodic snapshot to capture `cd` between opens.
  setInterval(part.report, POLL_INTERVAL_MS);
}
