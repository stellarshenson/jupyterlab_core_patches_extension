import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The patch effect is a scroll position held while images load. Image decode
 * timing is not reproducible in a browser test, so these tests assert the
 * patch's own marker: `data-jp-scroll-guard` appears on the active widget only
 * when the switch is on. The marker is set and cleared by the guard itself, so
 * the assertion fails when the gate or the guard breaks.
 */

/**
 * The switch key of the markdown tab scrolling patch.
 */
const SWITCH_KEY = 'jupyterlab_markdown_switch_tab_scrolling_fix';

/**
 * The attribute the patch sets while a scroll guard is live.
 */
const GUARD_SELECTOR = '[data-jp-scroll-guard="active"]';

/**
 * A 1x1 transparent PNG. The document refers to a real file, so the image
 * element attaches on its own; the held request keeps it from loading.
 */
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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
 * Leave every request for the image pending, so it never loads or errors and
 * the guard cannot settle on its own.
 */
async function holdImage(
  page: IJupyterLabPageFixture,
  imageName: string
): Promise<void> {
  await page.route(`**/*${imageName}*`, () => {
    // Deliberately leave the request hanging.
  });
}

/**
 * Open one document through the document manager. The command takes a
 * server-root relative path, so the open does not depend on the state of the
 * file browser.
 */
async function openDocument(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  await page.evaluate(async (target: string) => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('docmanager:open', { path: target });
  }, path);
}

/**
 * Create a Markdown document with the held image and a plain text document,
 * open both, then activate the Markdown tab a second time. The second
 * activation is the one that can guard, because the rendered markdown exists
 * by then.
 */
async function prepareDocuments(
  page: IJupyterLabPageFixture,
  markdownPath: string,
  textPath: string,
  imageName: string
): Promise<void> {
  // Every path here is server-root relative, which the contents API and the
  // document manager command both take.
  const directory = await page.filebrowser.getCurrentDirectory();
  const join = (name: string): string =>
    directory ? `${directory.replace(/\/$/, '')}/${name}` : name;
  const markdownDocument = join(markdownPath);
  const textDocument = join(textPath);

  const padding = 'Filler paragraph.\n\n'.repeat(20);
  await page.contents.uploadContent(
    `# Scroll guard\n\n${padding}![held](${imageName})\n`,
    'text',
    markdownDocument
  );
  await page.contents.uploadContent('Plain text.\n', 'text', textDocument);
  await page.contents.uploadContent(ONE_PIXEL_PNG, 'base64', join(imageName));

  await openDocument(page, markdownDocument);
  await page.locator(`img[src*="${imageName}"]`).waitFor({ state: 'attached' });
  await openDocument(page, textDocument);

  const tab = page.locator('.lm-TabBar-tab', { hasText: markdownPath });
  await tab.click();
  await expect(tab).toHaveClass(/lm-mod-current/);
}

test.describe('markdown switch-tab scrolling patch', () => {
  test('leaves the tab switch unguarded when the switch is off', async ({
    page
  }) => {
    await setSwitch(page, SWITCH_KEY, false);
    await holdImage(page, 'held-off.png');
    await prepareDocuments(
      page,
      'md-scroll-off.md',
      'md-scroll-off.txt',
      'held-off.png'
    );

    await page.waitForTimeout(600);
    await expect(page.locator(GUARD_SELECTOR)).toHaveCount(0);
  });

  test('guards the scroll position when the switch is on', async ({ page }) => {
    await setSwitch(page, SWITCH_KEY, true);
    await holdImage(page, 'held-on.png');
    await prepareDocuments(
      page,
      'md-scroll-on.md',
      'md-scroll-on.txt',
      'held-on.png'
    );

    await expect(page.locator(GUARD_SELECTOR)).toHaveCount(1, {
      timeout: 2000
    });
    // The guard releases on its own after its 3 second budget.
    await expect(page.locator(GUARD_SELECTOR)).toHaveCount(0, {
      timeout: 5000
    });
  });
});
