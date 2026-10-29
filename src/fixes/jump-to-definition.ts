import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { INotebookTracker } from '@jupyterlab/notebook';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { KernelMessage } from '@jupyterlab/services';
import { ICommandPalette, showErrorMessage } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { isPatchEnabled } from '../patches';
import {
  absoluteLine,
  collectCellSources,
  locateAbsoluteLine
} from './jump-to-definition/lines';
import {
  KERNEL_JUMP_COMMAND_ID,
  installLspCommandOverride
} from './jump-to-definition/override';
import { requestAPI } from './jump-to-definition/request';

/**
 * The settings key that switches this patch on and off.
 */
const SWITCH_KEY = 'jupyterlab_jump_to_definition_fix';

/**
 * Initialization data for the jupyterlab_jump_to_definition_fix extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_jump_to_definition_fix:plugin',
  description:
    "Jupyterlab fix disguised as extension to fix action 'jump to definition' from notebook to the source file / definition within the context of the notebook's kernel. Without the fix package would need to be installed in the same environment as jupyterlab to allo jump to definition",
  autoStart: true,
  requires: [INotebookTracker, IDocumentManager],
  optional: [ICommandPalette, ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    notebookTracker: INotebookTracker,
    docManager: IDocumentManager,
    palette: ICommandPalette | null,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (!(await isPatchEnabled(settingRegistry, SWITCH_KEY))) {
      return;
    }

    console.log(
      'JupyterLab extension jupyterlab_jump_to_definition_fix is activated!'
    );

    /**
     * Whether the current widget is a Python notebook with a running kernel.
     *
     * @returns `true` when the kernel command may run
     */
    const isPythonNotebook = (): boolean => {
      const notebook = notebookTracker.currentWidget;
      return (
        !!notebook &&
        !!notebook.sessionContext.session?.kernel &&
        (notebook.sessionContext.kernelDisplayName === 'Python 3 (ipykernel)' ||
          notebook.sessionContext.kernelDisplayName?.includes('Python') ===
            true)
      );
    };

    // Add our command for jumping to definition using Jedi in kernel
    const commandId = KERNEL_JUMP_COMMAND_ID;
    app.commands.addCommand(commandId, {
      label: 'Jump to definition',
      caption:
        'Jump to the definition of the selected symbol using Jedi in kernel environment',
      execute: async () => {
        const notebook = notebookTracker.currentWidget;
        if (!notebook) {
          console.error('[JumpToDef] No active notebook');
          await showErrorMessage(
            'Jump to Definition',
            'No active notebook found'
          );
          return;
        }

        const kernel = notebook.sessionContext.session?.kernel;
        if (!kernel) {
          console.error('[JumpToDef] No kernel available');
          await showErrorMessage(
            'Jump to Definition',
            'No kernel available. Please start a kernel first.'
          );
          return;
        }

        // Get active cell and cursor position
        const activeCell = notebook.content.activeCell;
        if (!activeCell || activeCell.model.type !== 'code') {
          await showErrorMessage('Jump to Definition', 'No active code cell');
          return;
        }

        const editor = activeCell.editor;
        if (!editor) {
          await showErrorMessage('Jump to Definition', 'No editor available');
          return;
        }

        const cursor = editor.getCursorPosition();

        // Collect all code cell sources and calculate absolute position
        const cells = notebook.content.widgets;
        const notebookSource = collectCellSources(cells);

        let activeCellIndex = -1;
        for (let i = 0; i < cells.length; i++) {
          if (cells[i] === activeCell) {
            activeCellIndex = i;
            break;
          }
        }

        // Calculate absolute line number (Jedi uses 1-based line numbers)
        const jediLine = absoluteLine(cells, activeCellIndex, cursor.line);
        const absoluteColumn = cursor.column;
        const notebookPath = notebook.context.path;

        // Get introspection code from server
        const response = await requestAPI<{ code: string }>(
          'introspection-code',
          app.serviceManager.serverSettings
        );

        // Replace placeholders
        const jediCode = response.code
          .replace('__CURSOR_LINE__', () => String(jediLine))
          .replace('__CURSOR_COLUMN__', () => String(absoluteColumn))
          .replace('__NOTEBOOK_PATH__', () => JSON.stringify(notebookPath))
          .replace('__NOTEBOOK_SOURCE__', () => JSON.stringify(notebookSource));

        // Execute in kernel
        const future = kernel.requestExecute({ code: jediCode });
        let output = '';

        future.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
          if (msg.header.msg_type === 'stream') {
            const content = msg.content as KernelMessage.IStreamMsg['content'];
            // Only capture stdout (JSON result), not stderr (debug logs)
            if (content.name === 'stdout') {
              output += content.text;
            }
          }
        };

        await future.done;

        // Parse result
        let result: {
          file: string | null;
          line: number | null;
          error: string | null;
          in_notebook?: boolean;
        };
        try {
          result = JSON.parse(output.trim());
        } catch (e) {
          await showErrorMessage(
            'Jump to Definition',
            `Failed to parse result: ${output}`
          );
          return;
        }

        if (result.error) {
          await showErrorMessage('Jump to Definition', result.error);
          return;
        }

        if (!result.file) {
          await showErrorMessage('Jump to Definition', 'No definition found');
          return;
        }

        // In-notebook definition: Jedi resolved the target to the notebook's own
        // source. Jump within the already-open notebook rather than reconstructing
        // a filesystem path (which doubles when the kernel cwd is the notebook's
        // own directory) and re-opening the file. This is cwd-independent and
        // matches jupyterlab-lsp's native behaviour.
        if (result.in_notebook && result.line) {
          // Map the absolute line (in the concatenated code-cell source) back to a
          // code cell and a line within that cell - the exact inverse of the
          // forward calculation above.
          const location = locateAbsoluteLine(cells, result.line);
          if (!location) {
            await showErrorMessage(
              'Jump to Definition',
              'Definition is in this notebook but its line could not be located'
            );
            return;
          }

          notebook.content.activeCellIndex = location.cellIndex;
          notebook.content.mode = 'edit';
          setTimeout(() => {
            const targetEditor = notebook.content.activeCell?.editor;
            if (targetEditor) {
              targetEditor.setCursorPosition({
                line: location.lineInCell,
                column: 0
              });
              targetEditor.focus();
            }
          }, 100);
          return;
        }

        console.log(
          '[JumpToDef] Opening:',
          result.file,
          'at line',
          result.line
        );

        // Convert absolute path to path relative to JupyterLab server root
        // Strategy: Get kernel's CWD and calculate server root from notebook path
        let filePath = result.file;

        // Get kernel's current working directory
        const cwdCode = 'import os; print(os.getcwd())';
        const cwdFuture = kernel.requestExecute({ code: cwdCode });
        let kernelCwd = '';

        cwdFuture.onIOPub = (msg: KernelMessage.IIOPubMessage) => {
          if (msg.header.msg_type === 'stream') {
            const content = msg.content as KernelMessage.IStreamMsg['content'];
            if (content.name === 'stdout') {
              kernelCwd += content.text;
            }
          }
        };

        await cwdFuture.done;
        kernelCwd = kernelCwd.trim();

        // Calculate server root from notebook path
        const notebookDir = notebookPath.substring(
          0,
          notebookPath.lastIndexOf('/')
        );
        let serverRoot = kernelCwd;
        if (kernelCwd.endsWith(notebookDir)) {
          serverRoot = kernelCwd.substring(
            0,
            kernelCwd.length - notebookDir.length
          );
        }

        // Strip server root from definition file path
        if (filePath.startsWith(serverRoot)) {
          filePath = filePath.substring(serverRoot.length);
          if (filePath.startsWith('/')) {
            filePath = filePath.substring(1);
          }
        }

        // Open the file
        const widget = await docManager.openOrReveal(filePath);
        if (widget && result.line) {
          setTimeout(() => {
            const content = widget.content as any;
            if (content && content.editor) {
              content.editor.setCursorPosition({
                line: result.line! - 1,
                column: 0
              });
              content.editor.focus();
            }
          }, 100);
        }
      },
      isEnabled: isPythonNotebook
    });

    // Don't add to command palette - we're replacing the stock LSP command
    // which is already in the palette

    // Bind keyboard shortcut (Ctrl+B or Cmd+B) for notebooks
    app.commands.addKeyBinding({
      command: commandId,
      keys: ['Accel B'],
      selector: '.jp-Notebook.jp-mod-editMode'
    });

    // Override the stock LSP command when it becomes available
    installLspCommandOverride(app, commandId, isPythonNotebook);
  }
};

export default plugin;
