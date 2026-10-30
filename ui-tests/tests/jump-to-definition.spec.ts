import { expect, test } from '@jupyterlab/galata';

const SWITCH_KEY = 'jupyterlab_jump_to_definition_fix';
const KERNEL_COMMAND = 'notebook:jump-to-definition-kernel';

/**
 * Set one patch switch through the settings registry, then reload the page so
 * the plugin reads the new value on activation.
 *
 * @param page - The Galata page object
 * @param key - The schema key that holds the switch
 * @param value - The value to store
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
 * Whether the running application holds the kernel jump command.
 *
 * @param page - The Galata page object
 * @returns `true` when the command is registered
 */
async function hasKernelCommand(page: any): Promise<boolean> {
  return page.evaluate(
    (id: string) => (window as any).jupyterapp.commands.hasCommand(id),
    KERNEL_COMMAND
  );
}

test('the switch turned off removes the kernel jump command', async ({
  page
}) => {
  // jupyterlab-lsp is not installed in this test environment, so there is no
  // stock lsp:jump-to-definition command to compare against. The switch proof
  // is the absence of the command marker this patch registers.
  await setSwitch(page, SWITCH_KEY, false);
  // The plugin activation is asynchronous; give the settings load time to
  // return before asserting the absence.
  await page.waitForTimeout(1000);
  expect(await hasKernelCommand(page)).toBe(false);
});

test('the enabled patch jumps to a definition inside the notebook', async ({
  page
}) => {
  await setSwitch(page, SWITCH_KEY, true);
  await page.waitForFunction(
    (id: string) =>
      (window as any).jupyterapp?.commands?.hasCommand(id) === true,
    KERNEL_COMMAND
  );

  // Create the notebook through the command: the menu helper waits for the
  // kernel-picker dialog, which this server does not raise, and saving an
  // untitled notebook opens a Save As dialog nobody answers. The patch reads
  // the notebook source and path from the widget, so neither step is needed.
  await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const panel = await app.commands.execute('notebook:create-new', {
      kernelName: 'python3'
    });
    await panel.context.ready;
    app.shell.activateById(panel.id);
    const notebook = panel.content;
    notebook.activeCellIndex = 0;
    notebook.activeCell.model.sharedModel.setSource(
      'def my_func():\n    return 1\n\nmy_func()'
    );
  });

  // The kernel must be running before the command can execute Jedi.
  await page.waitForFunction(() => {
    const panel = (window as any).jupyterapp.shell.currentWidget;
    return !!panel?.sessionContext?.session?.kernel;
  });

  // Put the cursor on my_func() and run the command. The in-notebook branch
  // maps the target line back to this cell and moves the cursor to the def.
  const result = await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    const notebook = app.shell.currentWidget.content;
    notebook.activeCellIndex = 0;
    notebook.activeCell.editor.setCursorPosition({ line: 3, column: 2 });
    await app.commands.execute('notebook:jump-to-definition-kernel');
    // The in-notebook branch moves the cursor after a 100 ms timeout.
    await new Promise(resolve => setTimeout(resolve, 500));
    return notebook.activeCell.editor.getCursorPosition().line;
  });

  expect(result).toBe(0);
});
