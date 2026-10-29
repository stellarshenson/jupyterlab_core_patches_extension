import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * JupyterLab 4.6 restores an anchor whose case matches the heading, so the
 * stock code already scrolls for exact-case fragments. The patch-only
 * behaviour the tests assert is the case-insensitive fallback: a lowercase
 * fragment against a title-case heading. The window marker proves that the
 * switch gates the patch installation, and the scroll position proves that the
 * installed patch navigates where the stock code does not.
 */

/**
 * The switch key of the markdown viewer TOC patch.
 */
const SWITCH_KEY = 'jupyterlab_markdown_viewer_toc_fix';

/**
 * The window key the patch sets after a successful activation.
 */
const PATCH_MARKER = '__jp_markdown_viewer_toc_fix__';

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
 * Upload a Markdown document with a title-case heading far below the fold,
 * open it in the Markdown Viewer and wait for its render.
 */
async function openDocument(
  page: IJupyterLabPageFixture,
  path: string
): Promise<void> {
  const padding = 'Filler paragraph.\n\n'.repeat(60);
  await page.contents.uploadContent(
    `# Introduction\n\n${padding}## Performance-Optimization\n\nTail paragraph.\n`,
    'text',
    path
  );
  await page.evaluate(async (target: string) => {
    await (window as any).jupyterapp.commands.execute('docmanager:open', {
      path: target,
      factory: 'Markdown Preview'
    });
  }, path);
  await page.waitForFunction(() => {
    const headings = Array.from(
      document.querySelectorAll('.jp-MarkdownViewer .jp-RenderedMarkdown h2')
    );
    return headings.some(heading =>
      (heading.textContent ?? '').includes('Performance-Optimization')
    );
  });
}

/**
 * Ask the current Markdown Viewer for a lowercase fragment whose heading is
 * title case, then report the scroll position of its scroller.
 */
async function scrollToCaseMismatchedFragment(
  page: IJupyterLabPageFixture
): Promise<number> {
  return page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const widget = app.shell.currentWidget;
    widget.content.setFragment('#performance-optimization');
    // Smooth scrolling and the stock re-render both settle well inside this.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const scroller = widget.content.node.querySelector(
      '.jp-RenderedMarkdown'
    ) as HTMLElement | null;
    return scroller?.scrollTop ?? 0;
  });
}

test.describe('markdown viewer TOC patch', () => {
  test('the switch removes and restores the patch marker', async ({ page }) => {
    await setSwitch(page, SWITCH_KEY, false);
    // Activation is asynchronous; give the settings load time to return.
    await page.waitForTimeout(1000);
    expect(
      await page.evaluate(
        (marker: string) => (window as any)[marker] === true,
        PATCH_MARKER
      )
    ).toBe(false);

    await setSwitch(page, SWITCH_KEY, true);
    await page.waitForFunction(
      (marker: string) => (window as any)[marker] === true,
      PATCH_MARKER
    );
  });

  test('the enabled patch scrolls to a fragment whose case differs from the heading', async ({
    page
  }) => {
    await setSwitch(page, SWITCH_KEY, true);
    await openDocument(page, 'toc-patch-on.md');

    expect(await scrollToCaseMismatchedFragment(page)).toBeGreaterThan(0);
  });

  test('the disabled patch leaves the same fragment unscrolled', async ({
    page
  }) => {
    await setSwitch(page, SWITCH_KEY, false);
    await openDocument(page, 'toc-patch-off.md');

    expect(await scrollToCaseMismatchedFragment(page)).toBe(0);
  });
});
