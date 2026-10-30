import { expect, test } from '@jupyterlab/galata';

const SWITCH_KEY = 'jupyterlab_change_ui_font_size_fix';
const PATCH_CLASS = 'jp-core-patches-change-ui-font-size';
const SAMPLE_FILE = 'icon-alignment-sample.txt';

test.use({ autoGoto: false });

/**
 * Set one patch switch through the settings registry and reload the page.
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
 * Create the file whose listing icon the test measures.
 */
async function createSampleFile(page: any, baseURL: string): Promise<void> {
  const response = await page.request.put(
    `${baseURL}/api/contents/${SAMPLE_FILE}`,
    {
      data: { type: 'file', format: 'text', content: 'alignment sample' }
    }
  );
  expect(response.ok()).toBe(true);
}

/**
 * Wait until the plugin has added or left out its body class.
 */
async function waitForPatchClass(page: any, expected: boolean): Promise<void> {
  await page.waitForFunction(
    ({ cls, expected }: { cls: string; expected: boolean }) =>
      document.body.classList.contains(cls) === expected,
    { cls: PATCH_CLASS, expected }
  );
}

/**
 * Read the listing icon size and the font variables that control it.
 */
async function readIcon(page: any): Promise<{
  width: number;
  height: number;
  fontSize: number;
  scale: number;
}> {
  return page
    .locator('.jp-DirListing-item', { hasText: SAMPLE_FILE })
    .locator('.jp-DirListing-itemIcon svg')
    .first()
    .evaluate((svg: Element) => {
      const iconStyle = getComputedStyle(svg);
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      return {
        width: parseFloat(iconStyle.width),
        height: parseFloat(iconStyle.height),
        fontSize: parseFloat(bodyStyle.getPropertyValue('--jp-ui-font-size1')),
        scale: parseFloat(rootStyle.getPropertyValue('--jp-custom-icon-scale'))
      };
    });
}

/**
 * The misalignment itself depends on rendered icon and text metrics and is not
 * stable in a headless browser. The test asserts the patch marker and the
 * computed icon size that the marker controls instead.
 */
test('the switch turns file browser icon scaling off and on', async ({
  page,
  baseURL
}) => {
  await createSampleFile(page, baseURL!);

  await page.goto();
  await page.locator('.jp-DirListing-item', { hasText: SAMPLE_FILE }).waitFor();
  await waitForPatchClass(page, true);

  const patched = await readIcon(page);
  expect(patched.scale).toBeCloseTo(1.5, 5);
  expect(patched.fontSize).toBeGreaterThan(0);
  expect(patched.width).toBeCloseTo(patched.fontSize * patched.scale, 1);
  expect(patched.height).toBeCloseTo(patched.width, 1);

  await setSwitch(page, SWITCH_KEY, false);
  await page.locator('.jp-DirListing-item', { hasText: SAMPLE_FILE }).waitFor();
  await waitForPatchClass(page, false);

  const stock = await readIcon(page);
  expect(stock.scale).toBeNaN();
  expect(stock.width).not.toBeCloseTo(patched.width, 1);

  await setSwitch(page, SWITCH_KEY, true);
  await page.locator('.jp-DirListing-item', { hasText: SAMPLE_FILE }).waitFor();
  await waitForPatchClass(page, true);

  const restored = await readIcon(page);
  expect(restored.scale).toBeCloseTo(1.5, 5);
  expect(restored.width).toBeCloseTo(restored.fontSize * restored.scale, 1);
});
