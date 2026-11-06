import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The reset this patch repairs happens in headed Chrome only: headless Chrome
 * keeps the frame offset across display:none, so a headless run cannot fail.
 * The spec is therefore headed and needs a display, such as xvfb-run.
 */
test.use({ headless: false });

/**
 * The switch key of the web tab scrolling patch.
 */
const SWITCH_KEY = 'jupyterlab_web_switch_tab_scrolling_fix';

/**
 * The same-origin paths of the two tall pages. The pages are served by a route
 * fixture rather than the contents API: this lab's contents manager installs a
 * custom files handler rooted away from the server root, so `/files` does not
 * serve the test folder. The route keeps the iframe same-origin and needs no
 * backend.
 */
const PAGE_PREFIX = '/web-scroll-pages';
const TARGET_FILE = 'web-scroll-target.html';
const OTHER_FILE = 'web-scroll-other.html';

/**
 * The scroll offset every restore assertion expects.
 */
const SCROLL_Y = 900;

/**
 * A page tall enough that a scroll to 900 is inside the document.
 */
const TALL_PAGE = `<!doctype html>
<html>
  <head>
    <title>Scroll page</title>
    <style>
      body { margin: 0; }
      main { height: 6000px; background: linear-gradient(#eef, #99f); }
    </style>
  </head>
  <body><main>Scroll page</main></body>
</html>
`;

/**
 * Wait until the application has started. A manual reload bypasses Galata's
 * own readiness wait, and a web tab opened before the shell restores its layout
 * is deferred and never becomes current, so the patch never sees it.
 */
async function waitForApp(page: IJupyterLabPageFixture): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).jupyterapp));
  await page.evaluate(async () => {
    await (window as any).jupyterapp.started;
  });
}

/**
 * Set one patch switch through the shared settings registry and reload, so the
 * activation gate reads the new value.
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
  await waitForApp(page);
}

/**
 * Serve both tall pages from a same-origin route and return their URLs.
 */
async function mockPages(
  page: IJupyterLabPageFixture
): Promise<{ target: string; other: string }> {
  await page.route(`**${PAGE_PREFIX}/*.html*`, route =>
    route.fulfill({ status: 200, contentType: 'text/html', body: TALL_PAGE })
  );
  return {
    target: `${PAGE_PREFIX}/${TARGET_FILE}`,
    other: `${PAGE_PREFIX}/${OTHER_FILE}`
  };
}

/**
 * Open one web tab through the server-proxy command.
 */
async function openWebTab(
  page: IJupyterLabPageFixture,
  id: string,
  title: string,
  url: string
): Promise<void> {
  await page.evaluate(
    async args => {
      const app = (window as any).jupyterapp;
      await app.commands.execute('server-proxy:open', args);
    },
    { id, title, url, newBrowserTab: false }
  );
}

/**
 * Read one frame state from the JupyterLab page. A frame that is navigating or
 * is cross-origin reads as `null`.
 */
async function frameState(
  page: IJupyterLabPageFixture,
  fileName: string
): Promise<{ y: number; height: number; ready: string } | null> {
  return page.evaluate((part: string) => {
    const iframe = Array.from(
      document.querySelectorAll<HTMLIFrameElement>('.jp-IFrame iframe')
    ).find(element => (element as HTMLIFrameElement).src.includes(part));
    if (!iframe || !iframe.contentWindow) {
      return null;
    }
    try {
      const frame = iframe.contentWindow as Window;
      return {
        y: frame.scrollY,
        height: frame.document.documentElement.scrollHeight,
        ready: frame.document.readyState
      };
    } catch {
      return null;
    }
  }, fileName);
}

/**
 * Read one frame's scrollY, or -1 while the document is not readable.
 */
async function frameScrollY(
  page: IJupyterLabPageFixture,
  fileName: string
): Promise<number> {
  const state = await frameState(page, fileName);
  return state ? state.y : -1;
}

/**
 * Scroll one frame to the given offset.
 */
async function scrollFrame(
  page: IJupyterLabPageFixture,
  fileName: string,
  y: number
): Promise<void> {
  await page.evaluate(
    ({ part, offset }: { part: string; offset: number }) => {
      const iframe = Array.from(
        document.querySelectorAll<HTMLIFrameElement>('.jp-IFrame iframe')
      ).find(element => (element as HTMLIFrameElement).src.includes(part));
      (iframe!.contentWindow as Window).scrollTo(0, offset);
    },
    { part: fileName, offset: y }
  );
}

/**
 * Reload one frame's document in place.
 */
async function reloadFrame(
  page: IJupyterLabPageFixture,
  fileName: string
): Promise<void> {
  await page.evaluate((part: string) => {
    const iframe = Array.from(
      document.querySelectorAll<HTMLIFrameElement>('.jp-IFrame iframe')
    ).find(element => (element as HTMLIFrameElement).src.includes(part));
    (iframe!.contentWindow as Window).location.reload();
  }, fileName);
}

/**
 * Activate a web tab by clicking its title. `shell.activateById` cannot do it:
 * the server-proxy widget gives its iframe the requested id, while the dock
 * holds a MainAreaWidget with a generated id.
 */
async function activateWebTab(
  page: IJupyterLabPageFixture,
  title: string
): Promise<void> {
  const tab = page.locator('.lm-TabBar-tab', { hasText: title });
  await tab.click();
  await expect(tab).toHaveClass(/lm-mod-current/);
}

/**
 * Wait until a frame document is loaded and tall enough for the scroll.
 */
async function waitForTallFrame(
  page: IJupyterLabPageFixture,
  fileName: string
): Promise<void> {
  // The document's height is readable before its load event. The patch's
  // load listener instruments the document, so scrolling before the event
  // would record nothing. Wait for the document to be complete.
  await expect
    .poll(async () => {
      const state = await frameState(page, fileName);
      return state && state.ready === 'complete' ? state.height : 0;
    })
    .toBeGreaterThan(SCROLL_Y);
  await page.waitForTimeout(200);
}

test.describe('web switch-tab scrolling patch', () => {
  test('keeps the frame position across a tab switch, a frame reload and a page reload', async ({
    page
  }) => {
    await setSwitch(page, SWITCH_KEY, true);
    const urls = await mockPages(page);

    await openWebTab(page, 'web-scroll-target', 'Scroll target', urls.target);
    await waitForTallFrame(page, TARGET_FILE);
    await scrollFrame(page, TARGET_FILE, SCROLL_Y);
    await expect.poll(() => frameScrollY(page, TARGET_FILE)).toBe(SCROLL_Y);

    // Opening the second tab hides the first. In headed Chrome the hidden
    // frame reads 0; that reset is the precondition for the restore below.
    await openWebTab(page, 'web-scroll-other', 'Scroll other', urls.other);
    await waitForTallFrame(page, OTHER_FILE);
    await expect.poll(() => frameScrollY(page, TARGET_FILE)).toBe(0);

    await activateWebTab(page, 'Scroll target');
    await expect.poll(() => frameScrollY(page, TARGET_FILE)).toBe(SCROLL_Y);

    // A frame document that reloads returns to its previous position.
    await reloadFrame(page, TARGET_FILE);
    await waitForTallFrame(page, TARGET_FILE);
    await expect.poll(() => frameScrollY(page, TARGET_FILE)).toBe(SCROLL_Y);

    // A full JupyterLab reload keeps the position in sessionStorage. The tab
    // is opened again with the same URL, as a workspace restore would.
    await page.reload();
    await page.locator('#main').waitFor();
    await waitForApp(page);
    await openWebTab(page, 'web-scroll-target', 'Scroll target', urls.target);
    await waitForTallFrame(page, TARGET_FILE);
    await expect.poll(() => frameScrollY(page, TARGET_FILE)).toBe(SCROLL_Y);
  });

  test('leaves the frame at the top when the switch is off', async ({
    page
  }) => {
    await setSwitch(page, SWITCH_KEY, false);
    const urls = await mockPages(page);

    await openWebTab(page, 'web-scroll-target', 'Scroll target', urls.target);
    await waitForTallFrame(page, TARGET_FILE);
    await scrollFrame(page, TARGET_FILE, SCROLL_Y);
    await expect.poll(() => frameScrollY(page, TARGET_FILE)).toBe(SCROLL_Y);

    await openWebTab(page, 'web-scroll-other', 'Scroll other', urls.other);
    await waitForTallFrame(page, OTHER_FILE);
    await expect.poll(() => frameScrollY(page, TARGET_FILE)).toBe(0);

    await activateWebTab(page, 'Scroll target');
    await page.waitForTimeout(1000);
    expect(await frameScrollY(page, TARGET_FILE)).toBe(0);
  });
});
