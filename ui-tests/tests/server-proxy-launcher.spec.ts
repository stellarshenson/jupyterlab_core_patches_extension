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
      const id = 'jupyterlab-core-patches-extension:plugin';
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
