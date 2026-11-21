import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The patch answers `server-proxy:open` from a cache built at activation. The
 * stock bug needs a real jupyter-server-proxy launcher entry, so the test
 * serves one entry from `/server-proxy/servers-info` and asserts the icon the
 * command registry returns for its title. With the switch off the stock
 * registry returns no icon, because `server-proxy:open` declares no icon
 * descriptor.
 */

/** Switch key of the server-proxy launcher patch. */
const SWITCH_KEY = 'jupyterlab_server_proxy_launcher_fix';

/** Marker the patch sets on the command registry. */
const PATCH_MARKER = '__serverProxyLauncherFixPatched';

/** Title of the launcher entry the route mock serves. */
const MOCK_TITLE = 'Mocked Service';

/** LabIcon name the patch builds for that entry. */
const MOCK_ICON_NAME = 'server-proxy-launcher-fix:mocked-service';

/** The server-proxy configuration the route mock serves. */
const SERVERS_INFO = {
  server_processes: [
    {
      name: 'mocked-service',
      new_browser_tab: false,
      launcher_entry: {
        enabled: true,
        title: MOCK_TITLE,
        path_info: '/mocked-service',
        category: 'Services'
      }
    }
  ]
};

test.use({ autoGoto: false });

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
}

/**
 * Read the icon name the command registry returns for the mocked launcher
 * title, or `null` when the stock method returns no icon.
 */
async function launcherIconName(
  page: IJupyterLabPageFixture
): Promise<string | null> {
  return page.evaluate((title: string) => {
    const icon = (window as any).jupyterapp.commands.icon('server-proxy:open', {
      title
    });
    return icon && typeof icon === 'object' && 'name' in icon
      ? (icon.name as string)
      : null;
  }, MOCK_TITLE);
}

/**
 * Whether the patch marker is set on the command registry.
 */
async function patchInstalled(page: IJupyterLabPageFixture): Promise<boolean> {
  return page.evaluate(
    (marker: string) => Boolean((window as any).jupyterapp.commands[marker]),
    PATCH_MARKER
  );
}

test('the switch turns the server-proxy launcher icon patch off and on', async ({
  page
}) => {
  // The patch's request carries a cache-busting query string, so the route
  // pattern must allow characters after the path.
  await page.route('**/server-proxy/servers-info*', route =>
    route.fulfill({ json: SERVERS_INFO })
  );
  await page.goto();

  await expect.poll(() => launcherIconName(page)).toBe(MOCK_ICON_NAME);
  expect(await patchInstalled(page)).toBe(true);

  await setSwitch(page, SWITCH_KEY, false);
  expect(await patchInstalled(page)).toBe(false);
  expect(await launcherIconName(page)).toBeNull();

  await setSwitch(page, SWITCH_KEY, true);
  await expect.poll(() => launcherIconName(page)).toBe(MOCK_ICON_NAME);
  expect(await patchInstalled(page)).toBe(true);
});

/**
 * A /proxy/<port>/ path whose pages a route serves, as the web tab scrolling
 * spec serves its pages: same-origin, no proxied server needed.
 */
const PROXY_PREFIX = '/proxy/8765';

/** The tab id; stock gives it to the tab's IFrame widget. */
const TAB_ID = 'reload-test';

/** The tab title. */
const TAB_TITLE = 'Reload test';

/**
 * Open one /proxy/<port>/ page in the test tab through `server-proxy:open`
 * with `reload: true`.
 */
async function openProxyPage(
  page: IJupyterLabPageFixture,
  file: string
): Promise<void> {
  await page.evaluate(
    async args => {
      await (window as any).jupyterapp.commands.execute(
        'server-proxy:open',
        args
      );
    },
    {
      id: TAB_ID,
      title: TAB_TITLE,
      url: `${PROXY_PREFIX}/${file}`,
      newBrowserTab: false,
      reload: true
    }
  );
}

/**
 * Read the path of the document in the test tab's frame, or `null` while no
 * loaded document is readable.
 */
async function framePath(page: IJupyterLabPageFixture): Promise<string | null> {
  return page.evaluate((id: string) => {
    const frame = document
      .getElementById(id)
      ?.querySelector('iframe')?.contentWindow;
    try {
      return frame && frame.document.readyState === 'complete'
        ? frame.location.pathname
        : null;
    } catch {
      return null;
    }
  }, TAB_ID);
}

test('ACC-PATCH-61-RELOAD-OPEN: open with reload loads the new url in the open tab', async ({
  page
}) => {
  await page.route(`**${PROXY_PREFIX}/*.html*`, route =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Proxy page</title><p>Proxy page</p>'
    })
  );
  await page.goto();

  // The tab is not open, so the call opens it as stock does.
  await openProxyPage(page, 'first.html');
  await expect.poll(() => framePath(page)).toBe(`${PROXY_PREFIX}/first.html`);
  await page.evaluate((id: string) => {
    (window as any).__labMarker = true;
    const frame = document.getElementById(id)!.querySelector('iframe')!;
    (frame.contentWindow as any).__frameMarker = true;
  }, TAB_ID);
  // A launcher in front, so the activation by the second call is visible.
  await page.evaluate(() =>
    (window as any).jupyterapp.commands.execute('launcher:create')
  );

  await openProxyPage(page, 'second.html');
  await expect.poll(() => framePath(page)).toBe(`${PROXY_PREFIX}/second.html`);
  const tab = page.locator('.lm-TabBar-tab', { hasText: TAB_TITLE });
  await expect(tab).toHaveCount(1);
  await expect(tab).toHaveClass(/lm-mod-current/);
  const markers = await page.evaluate((id: string) => {
    const frame = document.getElementById(id)!.querySelector('iframe')!;
    return {
      frame: Boolean((frame.contentWindow as any).__frameMarker),
      lab: Boolean((window as any).__labMarker)
    };
  }, TAB_ID);
  expect(markers).toEqual({ frame: false, lab: true });
});
