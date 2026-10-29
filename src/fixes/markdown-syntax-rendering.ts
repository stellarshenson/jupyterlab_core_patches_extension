import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { jupyterHighlightStyle } from '@jupyterlab/codemirror';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { isPatchEnabled } from '../patches';
import { injectHighlightRules } from './markdown-syntax-rendering/highlight';

/**
 * Initialization data for the jupyterlab_markdown_syntax_rendering_fix patch.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_markdown_syntax_rendering_fix:plugin',
  description:
    'Restore syntax highlighting in rendered Markdown code blocks by mounting the CodeMirror highlight StyleModule at startup, so token colours apply even when no editor is open.',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: async (
    _app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (
      !(await isPatchEnabled(
        settingRegistry,
        'jupyterlab_markdown_syntax_rendering_fix'
      ))
    ) {
      return;
    }

    console.log(
      'JupyterLab extension jupyterlab_markdown_syntax_rendering_fix is activated!'
    );

    // Rendered Markdown code blocks receive CodeMirror highlight token classes
    // (e.g. ͼs), but the StyleModule that gives those classes their colours is
    // only mounted when a CodeMirror EditorView is instantiated. With only
    // Markdown previews open, no editor exists, so the spans inherit the plain
    // code colour and look unhighlighted. Mounting the rules once - the same
    // effect as opening the editor - colours every preview, and the colours
    // track the active theme through --jp-mirror-editor-*-color variables.
    injectHighlightRules(jupyterHighlightStyle.module?.getRules() ?? '');
  }
};

export default plugin;
