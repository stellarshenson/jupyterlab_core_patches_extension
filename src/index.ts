import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import changeUiFontSize from './fixes/change-ui-font-size';
import fileBrowserColumnWidth from './fixes/file-browser-column-width';
import jumpToDefinition from './fixes/jump-to-definition';
import markdownSwitchTabScrolling from './fixes/markdown-switch-tab-scrolling';
import markdownSyntaxRendering from './fixes/markdown-syntax-rendering';
import markdownViewerToc from './fixes/markdown-viewer-toc';
import otherFileTypeMenu from './fixes/other-file-type-menu';
import restoreTerminals from './fixes/restore-terminals';
import serverProxyLauncher from './fixes/server-proxy-launcher';
import terminalCprEscape from './fixes/terminal-cpr-escape';
import { CORE_PATCHES_ID } from './patches';

/**
 * The schema owner and activation marker for the whole package.
 */
const corePatches: JupyterFrontEndPlugin<void> = {
  id: CORE_PATCHES_ID,
  description:
    'One JupyterLab extension carrying ten upstream core patches, each switchable from Settings',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: async (
    _app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    console.log(
      'JupyterLab extension @stellarshenson/jupyterlab-core-patches-extension is activated!'
    );

    if (!settingRegistry) {
      return;
    }
    try {
      const settings = await settingRegistry.load(CORE_PATCHES_ID);
      console.log(
        '@stellarshenson/jupyterlab-core-patches-extension settings loaded:',
        settings.composite
      );
    } catch (reason) {
      console.error(
        'Failed to load settings for @stellarshenson/jupyterlab-core-patches-extension.',
        reason
      );
    }
  }
};

export default [
  corePatches,
  changeUiFontSize,
  fileBrowserColumnWidth,
  jumpToDefinition,
  markdownSwitchTabScrolling,
  markdownSyntaxRendering,
  markdownViewerToc,
  otherFileTypeMenu,
  restoreTerminals,
  serverProxyLauncher,
  terminalCprEscape
];
