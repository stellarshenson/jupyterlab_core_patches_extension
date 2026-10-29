import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The patch records terminal folders by posting them to the server route. The
 * restore itself runs when the server next starts, before a browser connects,
 * which one Playwright run cannot restart. These tests prove the switch turns
 * the recording on and off; the startup restore is covered by the pytest suites
 * jupyterlab_core_patches_extension/tests/test_restore_terminals.py and
 * jupyterlab_core_patches_extension/tests/test_restore_terminals_restart.py.
 */

/**
 * The switch key of the restore-terminals patch.
 */
const SWITCH_KEY = 'jupyterlab_restore_terminals_fix';

/**
 * The route the frontend posts the in-layout terminal names to.
 */
const STATE_PATH = 'jupyterlab-restore-terminals-fix/state';

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
  // Activation awaits the settings load, so wait for every plugin before the
  // test opens a terminal the patch must observe.
  await page.waitForFunction(async () => {
    const app = (window as any).jupyterapp;
    if (typeof app === 'object') {
      await app.started;
      return true;
    }
    return false;
  });
}

/**
 * Open a terminal through the stock command and return its session name.
 */
async function openTerminal(page: IJupyterLabPageFixture): Promise<string> {
  return page.evaluate(async () => {
    const widget = await (window as any).jupyterapp.commands.execute(
      'terminal:create-new'
    );
    return widget.content.session.name as string;
  });
}

/**
 * Read the names of the terminals that hold an open main-area tab.
 */
async function openTerminalNames(
  page: IJupyterLabPageFixture
): Promise<string[]> {
  return page.evaluate(() => {
    const names: string[] = [];
    (window as any).jupyterapp.shell.widgets('main').forEach((widget: any) => {
      const name = widget.content?.session?.model?.name;
      if (name) {
        names.push(name);
      }
    });
    return names;
  });
}

test('leaves the stock behaviour when the switch is off', async ({ page }) => {
  await page.goto();
  await setSwitch(page, SWITCH_KEY, false);

  const posts: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes(STATE_PATH)) {
      posts.push(request.url());
    }
  });

  const name = await openTerminal(page);
  // The patch reports 2 s and 5 s after a terminal opens; wait past both.
  await page.waitForTimeout(7000);

  expect(await openTerminalNames(page)).toContain(name);
  expect(posts).toEqual([]);
});

test('saves a newly opened terminal when the switch is on', async ({
  page
}) => {
  await page.goto();
  await setSwitch(page, SWITCH_KEY, true);

  // The predicate ignores the empty periodic report until the terminal opens.
  let name = '';
  const requestPromise = page.waitForRequest(
    request =>
      request.method() === 'POST' &&
      request.url().includes(STATE_PATH) &&
      (request.postDataJSON()?.names ?? []).includes(name),
    { timeout: 10000 }
  );

  name = await openTerminal(page);
  const request = await requestPromise;

  expect(request.postDataJSON().names).toContain(name);
});
