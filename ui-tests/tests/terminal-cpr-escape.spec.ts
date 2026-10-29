import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The patch effect is the redraw of a terminal restored in a background tab.
 * The redraw reconnects the session, which opens a second websocket for that
 * terminal. The test counts the terminal's websocket opens instead of the
 * replayed history width: the width depends on the xterm buffer size and the
 * shell prompt, while the second open is produced by `refresh()` alone and
 * fails when the gate or the patch breaks.
 *
 * The server-side response filter has no Galata test: the idle-reconnect text
 * it removes needs a shell that strips ESC from a CPR response (fish), which
 * the test server does not guarantee.
 */

/**
 * The main switch of the terminal CPR patch.
 */
const SWITCH_KEY = 'jupyterlab_terminal_cpr_escape_fix';

/**
 * The option that gates the redraw of a background terminal.
 */
const REDRAW_KEY = 'redrawBackgroundTerminals';

/**
 * One frame on a terminal websocket.
 */
interface IWatchFrame {
  /** Epoch milliseconds. */
  t: number;
  /** Terminal name from the socket path. */
  term: string;
  /** `open` when the socket opened, `sent` for a frame the page sent. */
  dir: 'open' | 'sent';
  /** Raw frame payload. */
  payload?: string;
}

/**
 * Record the websocket frames of the page's terminal sessions. Construct it
 * before the page opens a terminal socket: the file turns `autoGoto` off and
 * each test calls `page.goto()` after the watch exists.
 */
class TerminalWatch {
  readonly frames: IWatchFrame[] = [];

  constructor(page: IJupyterLabPageFixture) {
    page.on('websocket', socket => {
      const match = /\/terminals\/websocket\/([^/?]+)/.exec(socket.url());
      if (!match) {
        return;
      }
      const term = decodeURIComponent(match[1]);
      this.frames.push({ t: Date.now(), term, dir: 'open' });
      socket.on('framesent', frame =>
        this.frames.push({
          t: Date.now(),
          term,
          dir: 'sent',
          payload: String(frame.payload)
        })
      );
    });
  }

  /** Frames of one terminal in one direction since an epoch-millisecond time. */
  since(term: string, dir: 'open' | 'sent', time: number): IWatchFrame[] {
    return this.frames.filter(
      frame => frame.term === term && frame.dir === dir && frame.t >= time
    );
  }
}

/**
 * Set one switch in the shared settings schema, save it, and reload so the
 * plugin reads the new value at activation.
 */
async function setSwitch(
  page: IJupyterLabPageFixture,
  key: string,
  value: boolean
): Promise<void> {
  await page.evaluate(
    async ({ key, value }: { key: string; value: boolean }) => {
      const app = (window as any).jupyterapp;
      const manager = app.serviceManager.settings;
      const id = 'jupyterlab_core_patches_extension:plugin';
      const plugin = await manager.fetch(id);
      const raw = JSON.parse(plugin.raw || '{}');
      raw[key] = value;
      await manager.save(id, JSON.stringify(raw));
    },
    { key, value }
  );
  await page.reload();
  await page.locator('#main').waitFor();
}

/**
 * The expression that finds a restored terminal widget by its session name.
 */
function findWidget(name: string): string {
  return `Array.from(window.jupyterapp.shell.widgets('main')).find(w => w.content?.session?.name === ${JSON.stringify(
    name
  )})`;
}

/**
 * The visibility and xterm state of terminal `name`.
 */
async function terminalState(
  page: IJupyterLabPageFixture,
  name: string
): Promise<{ visible: boolean; opened: boolean }> {
  return page.evaluate(
    `(w => ({ visible: !!w?.isVisible, opened: !!w?.content?._termOpened }))(${findWidget(
      name
    )})`
  );
}

/**
 * The xterm buffer of terminal `name` as text.
 */
async function bufferText(
  page: IJupyterLabPageFixture,
  name: string
): Promise<string> {
  return page.evaluate((name: string) => {
    const widget = Array.from(
      (window as any).jupyterapp.shell.widgets('main')
    ).find((w: any) => w.content?.session?.name === name) as any;
    const buffer = widget?.content?._term?.buffer.active;
    let text = '';
    for (let i = 0; i < (buffer?.length ?? 0); i++) {
      const line = buffer.getLine(i);
      text += line?.translateToString(true) ?? '';
    }
    return text;
  }, name);
}

/**
 * Create a terminal through the lab command and return its session name.
 */
async function createTerminal(page: IJupyterLabPageFixture): Promise<string> {
  return page.evaluate(async () => {
    const widget = await (window as any).jupyterapp.commands.execute(
      'terminal:create-new'
    );
    return widget.content.session.name as string;
  });
}

/**
 * Create a terminal and wait until a workspace save records a terminal other
 * than `background` as the current tab, so the next reload restores
 * `background` in a background tab.
 */
async function createTerminalInFront(
  page: IJupyterLabPageFixture,
  background = ''
): Promise<string> {
  const saved = page.waitForRequest(request => {
    if (
      request.method() !== 'PUT' ||
      !/\/api\/workspaces\//.test(request.url())
    ) {
      return false;
    }
    const layout = request.postDataJSON()?.data?.['layout-restorer:data'];
    const current = layout?.main?.current;
    return (
      typeof current === 'string' &&
      current.startsWith('terminal:') &&
      current !== `terminal:${background}`
    );
  });
  const name = await createTerminal(page);
  await saved;
  return name;
}

/**
 * Wait until terminal `name` has a connected session, without activating it.
 */
async function waitConnected(
  page: IJupyterLabPageFixture,
  name: string
): Promise<void> {
  await page.waitForFunction(
    `(${findWidget(name)})?.content?.session?.connectionStatus === 'connected'`,
    undefined,
    { timeout: 30000 }
  );
}

/**
 * Reload the page without galata's readiness check, which waits for a launcher
 * tab that a workspace holding only terminals never shows.
 */
async function reloadLab(page: IJupyterLabPageFixture): Promise<void> {
  await (page as any).reload({ waitForIsReady: false });
  await page.locator('#jupyterlab-splash').waitFor({ state: 'detached' });
}

/**
 * Print a marker in a fresh terminal, create a second terminal in front of it,
 * reload, and show the first terminal from its restored background tab.
 */
async function showBackgroundTerminal(
  page: IJupyterLabPageFixture,
  watch: TerminalWatch
): Promise<{ name: string; since: number }> {
  const name = await createTerminalInFront(page);
  await expect
    .poll(() => terminalState(page, name))
    .toEqual({ visible: true, opened: true });

  await page.evaluate(`(${findWidget(name)}).content._term.focus()`);
  await page.keyboard.insertText('echo MKR-BACKGROUND');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => bufferText(page, name), { timeout: 20000 })
    .toContain('MKR-BACKGROUND');

  await createTerminalInFront(page, name);

  const since = Date.now();
  await reloadLab(page);
  await waitConnected(page, name);
  await expect
    .poll(() => bufferText(page, name), { timeout: 20000 })
    .toContain('MKR-BACKGROUND');
  expect(await terminalState(page, name)).toEqual({
    visible: false,
    opened: false
  });

  await page.evaluate(async (name: string) => {
    await (window as any).jupyterapp.commands.execute('terminal:open', {
      name
    });
  }, name);
  await expect
    .poll(() => terminalState(page, name))
    .toEqual({ visible: true, opened: true });
  await page.waitForTimeout(1500);
  return { name, since };
}

test.use({ autoGoto: false });

test('leaves a restored background terminal to JupyterLab when the switch is off', async ({
  page
}) => {
  const watch = new TerminalWatch(page);
  await page.goto();
  await setSwitch(page, SWITCH_KEY, false);

  const { name, since } = await showBackgroundTerminal(page, watch);

  expect(watch.since(name, 'open', since)).toHaveLength(1);
});

test('redraws a restored background terminal when the switch is on', async ({
  page
}) => {
  const watch = new TerminalWatch(page);
  await page.goto();
  await setSwitch(page, SWITCH_KEY, true);

  const { name, since } = await showBackgroundTerminal(page, watch);

  expect(watch.since(name, 'open', since)).toHaveLength(2);
  const sizes = watch
    .since(name, 'sent', since)
    .map(frame => JSON.parse(frame.payload!) as any[])
    .filter(message => message[0] === 'set_size')
    .map(message => [message[1], message[2]]);
  expect(sizes).not.toContainEqual([24, 80]);
});

test('leaves the terminal to JupyterLab when redrawBackgroundTerminals is off', async ({
  page
}) => {
  const watch = new TerminalWatch(page);
  await page.goto();
  await setSwitch(page, SWITCH_KEY, true);
  await setSwitch(page, REDRAW_KEY, false);

  const { name, since } = await showBackgroundTerminal(page, watch);

  expect(watch.since(name, 'open', since)).toHaveLength(1);
});
