import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';

/**
 * The switch key in the shared settings schema.
 */
const SWITCH_KEY = 'jupyterlab_other_file_type_menu_fix';

test.use({ autoGoto: false });

/**
 * Wait until the application activated its plugins and restored the layout.
 * The patch registers its widget extension during activation, so an editor
 * opened before that point would miss the listener and the test would fail
 * for a reason unrelated to the switch.
 */
async function waitForApp(page: IJupyterLabPageFixture): Promise<void> {
  await page.locator('#main').waitFor();
  await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.started;
    await app.restored;
  });
}

/**
 * Set one patch switch through the shared settings registry and reload, so
 * the activation gate reads the new value.
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
  // A reload that restores two editors shows no Launcher tab, and the galata
  // readiness check waits for one. Skip that check and wait for the app here.
  await (page as any).reload({ waitForIsReady: false });
  await page.locator('#jupyterlab-splash').waitFor({ state: 'detached' });
  await waitForApp(page);
}

/**
 * Open a non-standard file and a text file side by side. The second file
 * stays current, so the first editor is visible but not current.
 *
 * @returns The ids of the first and second editor and of the current widget
 */
async function openSplitEditors(
  page: IJupyterLabPageFixture,
  firstPath: string,
  secondPath: string
): Promise<{ first: string; second: string; current: string }> {
  await page.contents.uploadContent('first\n', 'text', firstPath);
  await page.contents.uploadContent('second\n', 'text', secondPath);

  return page.evaluate(
    async ({ firstPath, secondPath }) => {
      const app = (window as any).jupyterapp;
      const first = await app.commands.execute('docmanager:open', {
        path: firstPath
      });
      const second = await app.commands.execute('docmanager:open', {
        path: secondPath
      });
      app.shell.add(first, 'main', { mode: 'split-left', ref: second.id });
      app.shell.activateById(second.id);
      // Activate requests are posted through the Lumino message loop.
      await new Promise(resolve => setTimeout(resolve, 0));
      (window as any).__otherFileTypeWidget = first;
      return {
        first: first.id as string,
        second: second.id as string,
        current: (app.shell.currentWidget?.id ?? '') as string
      };
    },
    { firstPath, secondPath }
  );
}

/**
 * Dispatch a contextmenu event on the non-current editor and report the
 * current widget before and after it.
 *
 * A real right-click is not used: its mousedown can focus the editor and
 * update the shell's focus tracker before the menu resolves, which would hide
 * whether the capture listener did the activation. The dispatch delivers the
 * same event to the same node without that focus side effect.
 */
async function contextMenuOtherEditor(
  page: IJupyterLabPageFixture
): Promise<{ before: string; after: string }> {
  return page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const widget = (window as any).__otherFileTypeWidget;
    const before = (app.shell.currentWidget?.id ?? '') as string;
    widget.node.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 8,
        clientY: 8
      })
    );
    // The patch activates through the Lumino message loop.
    await new Promise(resolve => setTimeout(resolve, 0));
    const after = (app.shell.currentWidget?.id ?? '') as string;
    app.contextMenu.menu.close();
    return { before, after };
  });
}

test('the switch controls activation of the editor under the context menu', async ({
  page
}) => {
  await page.goto();
  await waitForApp(page);

  // Switch on: the capture listener activates the right-clicked editor before
  // the menu resolves, so it becomes the current widget.
  const on = await openSplitEditors(page, 'LICENSE-on', 'sample-on.txt');
  expect(on.current).toBe(on.second);
  const patched = await contextMenuOtherEditor(page);
  expect(patched.before).toBe(on.second);
  expect(patched.after).toBe(on.first);

  // Switch off: no listener, so the current widget stays on the other editor.
  await setSwitch(page, SWITCH_KEY, false);
  const off = await openSplitEditors(page, 'LICENSE-off', 'sample-off.txt');
  expect(off.current).toBe(off.second);
  const stock = await contextMenuOtherEditor(page);
  expect(stock.before).toBe(off.second);
  expect(stock.after).toBe(off.second);

  // Switch back on: a reload registers the listener again.
  await setSwitch(page, SWITCH_KEY, true);
  const back = await openSplitEditors(page, 'LICENSE-back', 'sample-back.txt');
  const restored = await contextMenuOtherEditor(page);
  expect(restored.before).toBe(back.second);
  expect(restored.after).toBe(back.first);
});
