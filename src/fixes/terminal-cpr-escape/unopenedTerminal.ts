import type { Terminal } from '@jupyterlab/services';
import type { ITerminal } from '@jupyterlab/terminal';

/**
 * Terminals already held. A second call for the same terminal returns before
 * it wraps `session.send` again; a second wrapper would stay on the session
 * after the first open restores the original, and would refresh twice.
 */
const heldTerminals = new WeakSet<ITerminal.ITerminal>();

/**
 * Keep a terminal whose xterm is not opened yet from reporting its size, and
 * redraw its history once when the xterm is opened, if output arrived while
 * its tab was hidden.
 *
 * JupyterLab opens and fits the xterm only when the terminal's tab is visible.
 * Until then the xterm is 80x24: the widget reports that size to the server
 * and writes the replayed history into it. Holding back `set_size` keeps the
 * PTY at its real size, and `refresh()` at the first open makes the server
 * replay the history into the fitted xterm.
 *
 * @param terminal - The terminal widget
 * @param isEnabled - Read at each decision; false leaves the terminal to
 * JupyterLab
 */
export function holdUntilOpened(
  terminal: ITerminal.ITerminal,
  isEnabled: () => boolean
): void {
  if (heldTerminals.has(terminal)) {
    return;
  }
  /**
   * True once xterm.js has appended its element, of class `.xterm`, in
   * `Terminal.open()`.
   */
  const isOpened = () => terminal.node.querySelector('.xterm') !== null;
  if (isOpened()) {
    return;
  }
  heldTerminals.add(terminal);

  const session = terminal.session;
  const send = session.send;
  let hiddenOutput = false;

  /**
   * Record stdout that arrives while the tab is hidden. Output that arrives
   * while the tab is visible needs no redraw: the widget opens and fits the
   * xterm within a frame of creating it.
   */
  const onMessage = (_: unknown, message: Terminal.IMessage) => {
    if (message.type === 'stdout' && !terminal.isVisible) {
      hiddenOutput = true;
    }
  };
  /**
   * Restore the original `send` and disconnect the listeners and observer.
   */
  const release = () => {
    session.send = send;
    session.messageReceived.disconnect(onMessage);
    terminal.disposed.disconnect(release);
    observer.disconnect();
  };
  /**
   * Release at the first append of the xterm element, then refresh once when
   * output arrived while the tab was hidden.
   */
  const observer = new MutationObserver(() => {
    if (!isOpened()) {
      return;
    }
    release();
    if (hiddenOutput && isEnabled()) {
      terminal.refresh().catch(reason => {
        console.warn('Failed to redraw the terminal at its real size.', reason);
      });
    }
  });

  session.messageReceived.connect(onMessage);
  // Opened is read at call time: the widget sends the fitted size right after
  // it opens the xterm, before the observer runs.
  session.send = (message: Terminal.IMessage) => {
    if (message.type === 'set_size' && !isOpened() && isEnabled()) {
      return;
    }
    send.call(session, message);
  };
  terminal.disposed.connect(release);
  observer.observe(terminal.node, { childList: true });
}
