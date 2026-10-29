import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

const SWITCH_KEY = 'jupyterlab_file_browser_column_width_fix';
const PATCH_MARKER = '__fileBrowserColumnWidthFixPatched';
const ITEM_TEXT = '.jp-DirListing-itemText';

/**
 * Set one patch switch in the shared settings schema, save it, and reload so
 * the plugin reads the new value at activation.
 */
async function setSwitch(
  page: any,
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
  await page.evaluate(async () => {
    await (window as any).jupyterapp.restored;
  });
}

/**
 * Keep the default file browser listing on `window` for the test helpers.
 * Call it after every page load, including `page.reload()`.
 */
async function captureListing(page: IJupyterLabPageFixture): Promise<void> {
  await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    for (const widget of app.shell.widgets('left')) {
      const listing = (widget as any).listing;
      if (listing) {
        (window as any).__listing = listing;
        return;
      }
    }
    throw new Error('FileBrowser listing not found');
  });
}

interface IStaleWidthState {
  marker: boolean | undefined;
  width: number | null;
  isSelected: number;
  lastModified: number;
  live: number;
}

/**
 * Record the live content width, set a stale cached width of 24 px, then run
 * the listing's own column update and report what the update did.
 *
 * JupyterLab 4.6 lays out only the Name and Modified columns; the checkbox
 * column is not part of `_visibleColumns`, so the negative width the stock
 * clamp produces appears on `last_modified`.
 */
async function applyStaleWidth(
  page: IJupyterLabPageFixture
): Promise<IStaleWidthState> {
  return page.evaluate(marker => {
    const listing = (window as any).__listing;
    const live = listing._computeContentWidth();
    listing._width = 24;
    listing._updateColumnSizes();
    return {
      marker: listing.constructor.prototype[marker],
      width: listing._width,
      isSelected: listing._columnSizes.is_selected,
      lastModified: listing._columnSizes.last_modified,
      live
    };
  }, PATCH_MARKER);
}

test.beforeEach(async ({ page }) => {
  await page.goto();
  await page.contents.uploadContent('alpha', 'text', 'alpha.txt');
  await page.contents.uploadContent('beta', 'text', 'beta.txt');
  await page.locator(ITEM_TEXT).first().waitFor();
});

test('the switch off leaves the stock clamp to break the column sizes', async ({
  page
}) => {
  await setSwitch(page, SWITCH_KEY, false);
  await page.locator(ITEM_TEXT).first().waitFor();
  await captureListing(page);

  const state = await applyStaleWidth(page);

  expect(state.marker).toBeUndefined();
  expect(state.width).toBe(24);
  expect(state.live).toBeGreaterThan(24);
  expect(state.lastModified).toBeLessThan(0);
});

test('the switch on recovers a stale cached width', async ({ page }) => {
  await setSwitch(page, SWITCH_KEY, true);
  await page.locator(ITEM_TEXT).first().waitFor();
  await captureListing(page);

  await expect
    .poll(async () =>
      page.evaluate(
        marker => Boolean((window as any).__listing[marker]),
        PATCH_MARKER
      )
    )
    .toBe(true);

  const state = await applyStaleWidth(page);

  expect(state.marker).toBe(true);
  expect(state.width).toBe(state.live);
  expect(state.width).toBeGreaterThan(24);
  expect(state.isSelected).toBeGreaterThanOrEqual(18);
  expect(state.lastModified).toBeGreaterThanOrEqual(60);
});
