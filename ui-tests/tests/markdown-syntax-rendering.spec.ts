import { expect, test } from '@jupyterlab/galata';

/**
 * Don't load JupyterLab webpage before running the tests.
 * This is required to set the patch switch before the extension activates.
 */
test.use({ autoGoto: false });

/** Settings key of the markdown syntax rendering patch switch. */
const SWITCH_KEY = 'jupyterlab_markdown_syntax_rendering_fix';

/** Id of the style element the patch injects. */
const STYLE_ID = 'jupyterlab-markdown-syntax-rendering-fix-highlight';

/**
 * Set one patch switch through the settings registry, then reload so the
 * plugin reads the new value.
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
 * Wait until the patch plugin has activated, so its switch has been read and
 * its style element either exists or is deliberately absent.
 */
async function waitForSettings(page: any): Promise<void> {
  await page.waitForFunction(() => {
    const app = (window as any).jupyterapp;
    return (
      app?.isPluginActivated?.(
        'jupyterlab_markdown_syntax_rendering_fix:plugin'
      ) === true
    );
  });
}

/** Read the text of the patch's style element, or null when it is absent. */
async function highlightRules(page: any): Promise<string | null> {
  return page.evaluate(
    (id: string) => document.getElementById(id)?.textContent ?? null,
    STYLE_ID
  );
}

test.describe('markdown syntax rendering patch', () => {
  // Limitation: the stock bug appears only in a session where no CodeMirror
  // editor has ever mounted the highlight StyleModule. Galata may open editors,
  // so the test asserts the patch's own style element rather than the bug.
  test('the switch removes and restores the highlight style', async ({
    page
  }) => {
    await page.goto();

    await setSwitch(page, SWITCH_KEY, false);
    await waitForSettings(page);
    expect(await highlightRules(page)).toBeNull();

    await setSwitch(page, SWITCH_KEY, true);
    await page.waitForFunction(
      (id: string) => {
        const style = document.getElementById(id);
        return !!style && /ͼ/.test(style.textContent ?? '');
      },
      STYLE_ID,
      { timeout: 30000 }
    );

    const colour = await page.evaluate(() => {
      const span = document.createElement('span');
      span.className = 'ͼs';
      span.textContent = 'def';
      document.body.appendChild(span);
      const c = getComputedStyle(span).color;
      span.remove();
      return c;
    });
    expect(colour).toMatch(/^rgb/);
  });
});
