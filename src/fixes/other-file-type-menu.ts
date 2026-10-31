import type {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import type { DocumentRegistry } from '@jupyterlab/docregistry';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import type { IDisposable } from '@lumino/disposable';
import type { Widget } from '@lumino/widgets';

import { isPatchEnabled } from '../patches';

/**
 * Widget extension that fixes the context menu and LSP adapter for
 * non-standard file types (LICENSE, .gitignore, Dockerfile, etc.).
 *
 * Two problems are addressed:
 *
 * 1. Context menu: when a file has no registered file type, its FileEditor
 *    widget may not be the shell's currentWidget when the context menu fires.
 *    Lumino resolves commands against the wrong (previously active) widget,
 *    producing a stale and non-functional menu.
 *
 * 2. LSP crash: icon-providing extensions (e.g. vscode-icons) register file
 *    types with pattern matches but without mimeTypes. The LSP adapter's
 *    get mimeType getter calls getFileTypeForModel() which returns these
 *    incomplete types, then accesses mimeTypes[0] on undefined, causing a
 *    TypeError that disposes the virtual document and breaks all LSP context
 *    menu items.
 *
 * Fix: in createNew, patch incomplete file types in the document registry to
 * include a default mimeTypes array, and attach a capture-phase contextmenu
 * listener that calls shell.activateById() before Lumino processes the event.
 */
export class ContextMenuFixExtension
  implements DocumentRegistry.WidgetExtension
{
  /**
   * Whether the document registry was already scanned. A second widget
   * creation leaves the registry alone.
   */
  private _patched = false;

  /**
   * @param shell - The application shell whose active widget the menu reads
   * @param docRegistry - The document registry that holds the file types
   */
  constructor(
    private shell: JupyterFrontEnd.IShell,
    private docRegistry: DocumentRegistry
  ) {}

  /**
   * Patch the registry on the first call, then attach the capture-phase
   * contextmenu listener to the widget.
   *
   * @param widget - The editor widget whose node receives the listener
   * @param context - The document context; the patch does not read it
   * @returns A disposable that removes the listener
   */
  createNew(widget: Widget, context: DocumentRegistry.Context): IDisposable {
    const shell = this.shell;

    // Patch file types that lack mimeTypes once on first widget creation.
    // Icon extensions (e.g. vscode-icons) register types with patterns but
    // no mimeTypes, causing LSP to crash when it accesses mimeTypes[0].
    if (!this._patched) {
      this._patched = true;
      for (const ft of this.docRegistry.fileTypes()) {
        if (!ft.mimeTypes || ft.mimeTypes.length === 0) {
          (ft as any).mimeTypes = ['text/plain'];
        }
      }
    }

    const handler = () => {
      shell.activateById(widget.id);
    };

    widget.node.addEventListener('contextmenu', handler, true);

    let disposed = false;
    return {
      get isDisposed() {
        return disposed;
      },
      dispose() {
        if (!disposed) {
          widget.node.removeEventListener('contextmenu', handler, true);
          disposed = true;
        }
      }
    };
  }
}

/**
 * Initialization data for the jupyterlab_other_file_type_menu_fix extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: '@stellarshenson/jupyterlab-core-patches-extension:other-file-type-menu',
  description:
    'Fix context menu for non-standard file types (LICENSE, .gitignore, etc.) ' +
    'that show stale/inert menus with broken hover highlighting',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (
      !(await isPatchEnabled(
        settingRegistry,
        'jupyterlab_other_file_type_menu_fix'
      ))
    ) {
      return;
    }

    console.log(
      'JupyterLab extension jupyterlab_other_file_type_menu_fix is activated!'
    );

    app.docRegistry.addWidgetExtension(
      'Editor',
      new ContextMenuFixExtension(app.shell, app.docRegistry)
    );
  }
};

export default plugin;
