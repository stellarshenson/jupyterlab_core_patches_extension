import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { isPatchEnabled } from '../patches';

import { installServerProxyLauncherFix } from './server-proxy-launcher/patch';

/**
 * The switch key in the shared settings schema.
 */
const SWITCH_KEY = 'jupyterlab_server_proxy_launcher_fix';

/**
 * Initialization data for the jupyterlab_server_proxy_launcher_fix patch.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_server_proxy_launcher_fix:plugin',
  description:
    'Render SVG icons of jupyter-server-proxy launchers in custom launcher categories',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (!(await isPatchEnabled(settingRegistry, SWITCH_KEY))) {
      return;
    }

    console.log(
      'JupyterLab extension jupyterlab_server_proxy_launcher_fix is activated!'
    );

    try {
      await installServerProxyLauncherFix(app.commands);
    } catch {
      // Silently fail - extension is non-critical
    }
  }
};

export default plugin;
