import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { isPatchEnabled, PATCH_CLASS_PREFIX } from '../patches';

/**
 * The body class that enables the scoped rules in `style/change-ui-font-size.css`.
 */
export const PATCH_CLASS = `${PATCH_CLASS_PREFIX}change-ui-font-size`;

/**
 * Initialization data for the jupyterlab_change_ui_font_size_fix extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-core-patches-extension:change-ui-font-size',
  description:
    'Jupyterlab fix disguised as extension, to fix issue with changes to the UI font size, where file navigator item names get misaligned with icons',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: async (
    _app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (
      !(await isPatchEnabled(
        settingRegistry,
        'jupyterlab_change_ui_font_size_fix'
      ))
    ) {
      return;
    }
    document.body.classList.add(PATCH_CLASS);
    console.log(
      'JupyterLab extension jupyterlab_change_ui_font_size_fix is activated!'
    );
  }
};

export default plugin;
