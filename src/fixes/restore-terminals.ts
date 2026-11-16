import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';

import { isPatchEnabled } from '../patches';
import { requestAPI } from './restore-terminals/request';
import { registerRestore } from './terminal-session';

/**
 * The settings key that switches this patch on and off.
 */
export const SWITCH_KEY = 'jupyterlab_restore_terminals_fix';

/**
 * The window key that makes a second activation a no-op.
 */
export const PATCH_MARKER = '__jp_restore_terminals_fix__';

/**
 * Report the names of all terminals currently in the layout to the server.
 *
 * The server resolves each one's cwd and persists it, then re-creates
 * those terminals on its next startup so the built-in workspace restore
 * connects to them already in the right directory. We send only the
 * tracker's terminals (i.e. those with a live widget / open tab) so
 * closed-tab sessions are not restored and do not become ghost entries.
 * An empty list is sent too, so closing the last tab clears its entry.
 *
 * @param terminalTracker - The tracker holding the terminals with open tabs
 * @param serverSettings - The server settings used for the request
 */
async function reportLayoutTerminals(
  terminalTracker: ITerminalTracker,
  serverSettings: any
): Promise<void> {
  const names: string[] = [];
  terminalTracker.forEach(widget => {
    const name = widget.content.session?.model?.name;
    if (name) {
      names.push(name);
    }
  });
  try {
    await requestAPI('state', serverSettings, {
      method: 'POST',
      body: JSON.stringify({ names })
    });
  } catch {
    // ignore reporting errors
  }
}

/**
 * Initialization data for the jupyterlab_restore_terminals_fix extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-core-patches-extension:restore-terminals',
  description:
    'Restores terminal working directories after workspace restoration.',
  autoStart: true,
  requires: [ITerminalTracker],
  optional: [ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    terminalTracker: ITerminalTracker,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (!(await isPatchEnabled(settingRegistry, SWITCH_KEY))) {
      return;
    }
    if ((window as any)[PATCH_MARKER]) {
      return;
    }
    (window as any)[PATCH_MARKER] = true;

    console.log(
      'JupyterLab extension jupyterlab_restore_terminals_fix is activated!'
    );
    const serverSettings = app.serviceManager.serverSettings;

    // Restore is handled entirely server-side: the server pre-creates the
    // saved terminals at startup, before any frontend connects, so the
    // stock terminal plugin's restore connects to them in the right cwd.
    // The frontend only reports which terminals are in-layout and lets
    // the server snapshot their cwds. The shared terminal-session module
    // runs the report after a terminal opens and every 15 seconds.
    registerRestore(terminalTracker, {
      report: () => {
        reportLayoutTerminals(terminalTracker, serverSettings);
      }
    });
  }
};

export default plugin;
