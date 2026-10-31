import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { ITerminalTracker } from '@jupyterlab/terminal';

import { CORE_PATCHES_ID, isPatchEnabled } from '../patches';

import { holdUntilOpened } from './terminal-cpr-escape/unopenedTerminal';

/**
 * The switch key in the shared settings schema.
 */
const SWITCH_KEY = 'jupyterlab_terminal_cpr_escape_fix';

/**
 * The option that lets a background terminal be redrawn at its real size when
 * its tab is first shown. The source read it from its own plugin schema; the
 * port reads it from the shared schema.
 */
const REDRAW_OPTION = 'redrawBackgroundTerminals';

/**
 * Frontend part of the CPR filter extension.
 *
 * The filtering of terminal query responses happens server-side in
 * `jupyter_server_terminals`. This plugin handles terminals whose xterm is not
 * opened yet (a background tab after a page load): such a terminal sends no
 * size to the server; at its first show the widget sends the fitted size and
 * the hold steps the PTY once, so the running program repaints at it.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-core-patches-extension:terminal-cpr-escape',
  description:
    'Fix CPR escape sequences in idle terminal reconnections and redraw background terminals at their real size when first shown',
  autoStart: true,
  optional: [ITerminalTracker, ISettingRegistry],
  activate: async (
    _app: JupyterFrontEnd,
    tracker: ITerminalTracker | null,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (!(await isPatchEnabled(settingRegistry, SWITCH_KEY))) {
      return;
    }

    console.log(
      'JupyterLab extension jupyterlab_terminal_cpr_escape_fix is activated!'
    );
    if (!tracker) {
      return;
    }

    let settings: ISettingRegistry.ISettings | null = null;
    if (settingRegistry) {
      settingRegistry
        .load(CORE_PATCHES_ID)
        .then(loaded => {
          settings = loaded;
        })
        .catch(reason => {
          console.error(
            'Failed to load settings for jupyterlab_terminal_cpr_escape_fix.',
            reason
          );
        });
    }
    /**
     * Read `redrawBackgroundTerminals` at each decision. True until the
     * settings load, as in the source.
     */
    const isEnabled = () =>
      settings === null || (settings.get(REDRAW_OPTION).composite as boolean);

    tracker.widgetAdded.connect((_, widget) => {
      holdUntilOpened(widget.content, isEnabled);
    });
  }
};

export default plugin;
