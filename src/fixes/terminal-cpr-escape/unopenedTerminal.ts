import type { Terminal } from '@jupyterlab/services';
import type { ITerminal } from '@jupyterlab/terminal';

/**
 * Terminals already held. A second call for the same terminal returns before
 * it wraps `session.send` again; a second wrapper would stay on the session
 * after the first open restores the original.
 */
const heldTerminals = new WeakSet<ITerminal.ITerminal>();

/**
 * Pause between the two steps that make the program repaint at the fitted
 * size. Matches the server's `_BOUNCE_STEP`.
 */
const BOUNCE_STEP = 120;

/**
 * Keep a terminal whose xterm is not opened yet from reporting its size, then
 * step the PTY once so the running program repaints at the fitted size.
 *
 * JupyterLab opens and fits the xterm only when the terminal's tab is visible.
 * Until then the xterm is 80x24: the widget reports that size to the server
 * and the PTY shrinks to it. Holding back `set_size` keeps the PTY at its real
 * size. Once the xterm opens, the widget sends the fitted size, and the patch
 * sets the PTY one column narrower and back: terminado resizes the PTY only
 * when the size differs, and a restored terminal in an unchanged layout
 * already has the fitted size, so the fitted size alone sends no SIGWINCH and
 * the program never repaints.
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

  /**
   * Restore the original `send` and disconnect the observer.
   */
  const release = () => {
    session.send = send;
    terminal.disposed.disconnect(release);
    observer.disconnect();
  };
  /**
   * Release at the first append of the xterm element.
   */
  const observer = new MutationObserver(() => {
    if (!isOpened()) {
      return;
    }
    release();
  });

  /**
   * True once the first fitted size has been followed by a repaint step.
   */
  let stepped = false;

  // Opened is read at call time: the widget sends the fitted size right after
  // it opens the xterm, before the observer runs.
  session.send = (message: Terminal.IMessage) => {
    if (message.type === 'set_size' && !isOpened() && isEnabled()) {
      return;
    }
    send.call(session, message);
    if (
      message.type !== 'set_size' ||
      !message.content ||
      stepped ||
      !isEnabled()
    ) {
      return;
    }
    stepped = true;
    const [rows, cols, height, width] = message.content as number[];
    // terminado resizes the PTY only when the size differs, so the fitted
    // size alone leaves a restored terminal without SIGWINCH. Step one column
    // narrower and back so the program repaints at the fitted size.
    send.call(session, {
      type: 'set_size',
      content: [rows, cols - 1, height, width]
    });
    setTimeout(() => {
      if (!terminal.isDisposed) {
        send.call(session, {
          type: 'set_size',
          content: [rows, cols, height, width]
        });
      }
    }, BOUNCE_STEP);
  };
  terminal.disposed.connect(release);
  observer.observe(terminal.node, { childList: true });
}
