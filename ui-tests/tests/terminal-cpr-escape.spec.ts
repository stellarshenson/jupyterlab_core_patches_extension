import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The patch effect is the redraw of a terminal restored in a background tab.
 * The redraw does not reconnect: the first show sends the fitted size and the
 * patch steps the PTY one column narrower and back, which makes the running
 * program repaint. The test counts the terminal's websocket opens instead of
 * the replayed history width: the width depends on the xterm buffer size and
 * the shell prompt, while a second open would come only from a reconnect.
 *
 * The server-side response filter has no Galata test: the idle-reconnect text
 * it removes needs a shell that strips ESC from a CPR response (fish), which
 * the test server does not guarantee.
 *
 * The reconnect tests route the terminal websocket through the test, so a
 * dropped connection and refused retries are made on demand. They lower the
 * session's retry limit from 7 to 1: JupyterLab then gives up after one
 * refused retry instead of after up to 120 s of random delays.
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
      const id = '@stellarshenson/jupyterlab-core-patches-extension:plugin';
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
 * The xterm buffer lines of terminal `name`, without trailing spaces.
 */
async function bufferLines(
  page: IJupyterLabPageFixture,
  name: string
): Promise<string[]> {
  return page.evaluate((name: string) => {
    const widget = Array.from(
      (window as any).jupyterapp.shell.widgets('main')
    ).find((w: any) => w.content?.session?.name === name) as any;
    const buffer = widget?.content?._term?.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < (buffer?.length ?? 0); i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    return lines;
  }, name);
}

/**
 * The xterm buffer of terminal `name` as text.
 */
async function bufferText(
  page: IJupyterLabPageFixture,
  name: string
): Promise<string> {
  return (await bufferLines(page, name)).join('');
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

/**
 * The test's control over the page's terminal websockets.
 */
interface ITerminalRoute {
  /** True closes every new terminal socket at once, as an unreachable server does. */
  refuse: boolean;
  /** Close the newest socket that reached the server. */
  closeLive: () => Promise<void>;
}

/**
 * Route the page's terminal websockets through the test. Call it before
 * `page.goto()`: only sockets created after the call are routed. A socket is
 * closed with code 4000 while `refuse` is true and connected to the server
 * otherwise; JupyterLab retries after any code other than 1000 and 1001.
 */
async function routeTerminals(
  page: IJupyterLabPageFixture
): Promise<ITerminalRoute> {
  const route: ITerminalRoute = {
    refuse: false,
    closeLive: async () => undefined
  };
  await page.routeWebSocket(/\/terminals\/websocket\//, ws => {
    if (route.refuse) {
      void ws.close({ code: 4000, reason: 'refused by the test' });
      return;
    }
    ws.connectToServer();
    route.closeLive = () =>
      ws.close({ code: 4000, reason: 'dropped by the test' });
  });
  return route;
}

/**
 * Create a terminal in front and wait until its xterm is open and its session
 * is connected.
 */
async function openTerminal(page: IJupyterLabPageFixture): Promise<string> {
  const name = await createTerminal(page);
  await expect
    .poll(() => terminalState(page, name))
    .toEqual({ visible: true, opened: true });
  await waitConnected(page, name);
  return name;
}

/**
 * Bring terminal `name` to the state JupyterLab leaves after its last failed
 * retry: status `disconnected` and no retry scheduled. Lowers the session's
 * retry limit to 1, drops the live socket and refuses the one retry, then lets
 * new sockets reach the server again.
 */
async function giveUp(
  page: IJupyterLabPageFixture,
  route: ITerminalRoute,
  name: string
): Promise<void> {
  await page.evaluate(
    `(${findWidget(name)}).content.session._reconnectLimit = 1`
  );
  route.refuse = true;
  await route.closeLive();
  await page.waitForFunction(
    `(${findWidget(name)})?.content?.session?.connectionStatus === 'disconnected'`,
    undefined,
    { timeout: 10000 }
  );
  route.refuse = false;
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

  expect(watch.since(name, 'open', since)).toHaveLength(1);
  const sizes = watch
    .since(name, 'sent', since)
    .map(frame => JSON.parse(frame.payload!) as any[])
    .filter(message => message[0] === 'set_size')
    .map(message => [message[1], message[2]]);
  expect(sizes).not.toContainEqual([24, 80]);
  expect(
    sizes.some(
      (size, index) =>
        index > 0 &&
        size[0] === sizes[index - 1][0] &&
        size[1] === sizes[index - 1][1] - 1
    )
  ).toBe(true);
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

test('reconnects a terminal JupyterLab gave up on when the page is shown', async ({
  page
}) => {
  const route = await routeTerminals(page);
  await page.goto();
  await setSwitch(page, SWITCH_KEY, true);
  const name = await openTerminal(page);

  // The command line holds `$((40+2))`; only the output holds the marker.
  await page.evaluate(`(${findWidget(name)}).content._term.focus()`);
  await page.keyboard.insertText('sleep 5; echo MKR-VISIBLE-$((40+2))');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => bufferText(page, name), { timeout: 20000 })
    .toContain('echo MKR-VISIBLE-');
  await giveUp(page, route, name);
  expect(await bufferText(page, name)).not.toContain('MKR-VISIBLE-42');

  await page.evaluate(() => {
    if (document.visibilityState !== 'visible') {
      throw new Error('the test page is not visible');
    }
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await waitConnected(page, name);
  await expect
    .poll(() => bufferText(page, name), { timeout: 20000 })
    .toContain('MKR-VISIBLE-42');
});

test('sends text typed into a terminal JupyterLab gave up on after the reconnect', async ({
  page
}) => {
  const route = await routeTerminals(page);
  await page.goto();
  await setSwitch(page, SWITCH_KEY, true);
  const name = await openTerminal(page);
  await giveUp(page, route, name);

  await page.evaluate(`(${findWidget(name)}).content._term.focus()`);
  await page.keyboard.type('echo back');
  await page.keyboard.press('Enter');

  await waitConnected(page, name);
  await expect
    .poll(() => bufferLines(page, name), { timeout: 20000 })
    .toContain('back');
});
