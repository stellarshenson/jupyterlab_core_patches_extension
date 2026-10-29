import { expect, test } from '@jupyterlab/galata';

const PATCH_KEYS = [
  'jupyterlab_change_ui_font_size_fix',
  'jupyterlab_file_browser_column_width_fix',
  'jupyterlab_jump_to_definition_fix',
  'jupyterlab_markdown_switch_tab_scrolling_fix',
  'jupyterlab_markdown_syntax_rendering_fix',
  'jupyterlab_markdown_viewer_toc_fix',
  'jupyterlab_other_file_type_menu_fix',
  'jupyterlab_restore_terminals_fix',
  'jupyterlab_server_proxy_launcher_fix',
  'jupyterlab_terminal_cpr_escape_fix'
];

test.use({ autoGoto: false });

test('emits the activation message once', async ({ page }) => {
  const logs: string[] = [];

  page.on('console', message => {
    logs.push(message.text());
  });

  await page.goto();

  expect(
    logs.filter(
      line =>
        line ===
        'JupyterLab extension jupyterlab_core_patches_extension is activated!'
    )
  ).toHaveLength(1);
});

test('loads one default-on switch per patch', async ({ page }) => {
  await page.goto();

  const schema = await page.evaluate(async (id: string) => {
    const app = (window as any).jupyterapp;
    const plugin = await app.serviceManager.settings.fetch(id);
    return plugin.schema;
  }, 'jupyterlab_core_patches_extension:plugin');

  const defaults = PATCH_KEYS.map(
    key => schema.properties[key]?.default as boolean | undefined
  );

  expect(defaults).toEqual(PATCH_KEYS.map(() => true));
});
