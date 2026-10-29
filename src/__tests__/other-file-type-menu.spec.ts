import type { JupyterFrontEnd } from '@jupyterlab/application';
import type { DocumentRegistry } from '@jupyterlab/docregistry';
import type { ISettingRegistry } from '@jupyterlab/settingregistry';

import { Widget } from '@lumino/widgets';

import plugin, { ContextMenuFixExtension } from '../fixes/other-file-type-menu';

/**
 * The file type shape the patch reads and writes.
 */
interface IFakeFileType {
  name: string;
  mimeTypes?: string[];
}

/**
 * A document registry stand-in. `fileTypes` returns the given types and
 * records every scan; `addWidgetExtension` records every registration.
 */
function createRegistry(types: IFakeFileType[]): {
  docRegistry: DocumentRegistry;
  extensions: Array<{
    factory: string;
    extension: DocumentRegistry.WidgetExtension;
  }>;
  scans: jest.Mock;
} {
  const extensions: Array<{
    factory: string;
    extension: DocumentRegistry.WidgetExtension;
  }> = [];
  const scans = jest.fn(() => types);
  const docRegistry = {
    fileTypes: scans,
    addWidgetExtension(
      factory: string,
      extension: DocumentRegistry.WidgetExtension
    ): void {
      extensions.push({ factory, extension });
    }
  };
  return {
    docRegistry: docRegistry as unknown as DocumentRegistry,
    extensions,
    scans
  };
}

/**
 * An application shell stand-in that records `activateById` calls.
 */
function createShell(): {
  shell: JupyterFrontEnd.IShell;
  activate: jest.Mock;
} {
  const activate = jest.fn();
  return {
    shell: { activateById: activate } as unknown as JupyterFrontEnd.IShell,
    activate
  };
}

/**
 * A document context the patch does not read.
 */
const CONTEXT = {} as unknown as DocumentRegistry.Context;

/**
 * A settings registry whose switch key reads the given value.
 */
function registryWithSwitch(value: boolean): ISettingRegistry {
  return {
    load: async () => ({
      get: () => ({ composite: value })
    })
  } as unknown as ISettingRegistry;
}

describe('ContextMenuFixExtension', () => {
  it('gives every file type without mime types the default', () => {
    const types: IFakeFileType[] = [
      { name: 'empty', mimeTypes: [] },
      { name: 'missing' },
      { name: 'python', mimeTypes: ['text/x-python'] }
    ];
    const { docRegistry } = createRegistry(types);
    const extension = new ContextMenuFixExtension(
      createShell().shell,
      docRegistry
    );

    extension.createNew(new Widget(), CONTEXT).dispose();

    expect(types[0].mimeTypes).toEqual(['text/plain']);
    expect(types[1].mimeTypes).toEqual(['text/plain']);
    expect(types[2].mimeTypes).toEqual(['text/x-python']);
  });

  it('scans the registry once, so a second widget creation is a no-op', () => {
    const { docRegistry, scans } = createRegistry([{ name: 'missing' }]);
    const extension = new ContextMenuFixExtension(
      createShell().shell,
      docRegistry
    );

    extension.createNew(new Widget(), CONTEXT).dispose();
    extension.createNew(new Widget(), CONTEXT).dispose();

    expect(scans).toHaveBeenCalledTimes(1);
  });

  it('activates the widget on a contextmenu event from inside its node', () => {
    const { docRegistry } = createRegistry([]);
    const { shell, activate } = createShell();
    const extension = new ContextMenuFixExtension(shell, docRegistry);
    const widget = new Widget();
    widget.id = 'editor-widget';
    extension.createNew(widget, CONTEXT);

    const child = document.createElement('span');
    widget.node.appendChild(child);
    child.dispatchEvent(new Event('contextmenu', { bubbles: true }));

    expect(activate).toHaveBeenCalledWith('editor-widget');
  });

  it('listens in the capture phase, before a bubble handler on the widget', () => {
    const order: string[] = [];
    const shell = {
      activateById: jest.fn(() => {
        order.push('activate');
      })
    } as unknown as JupyterFrontEnd.IShell;
    const { docRegistry } = createRegistry([]);
    const extension = new ContextMenuFixExtension(shell, docRegistry);
    const widget = new Widget();
    const child = document.createElement('span');
    widget.node.appendChild(child);
    widget.node.addEventListener('contextmenu', () => {
      order.push('bubble');
    });

    extension.createNew(widget, CONTEXT);
    child.dispatchEvent(new Event('contextmenu', { bubbles: true }));

    expect(order).toEqual(['activate', 'bubble']);
  });

  it('removes the listener on dispose and disposes once', () => {
    const { docRegistry } = createRegistry([]);
    const { shell, activate } = createShell();
    const extension = new ContextMenuFixExtension(shell, docRegistry);
    const widget = new Widget();
    widget.id = 'editor-widget';
    const disposable = extension.createNew(widget, CONTEXT);
    const child = document.createElement('span');
    widget.node.appendChild(child);

    child.dispatchEvent(new Event('contextmenu', { bubbles: true }));
    expect(activate).toHaveBeenCalledTimes(1);

    disposable.dispose();
    expect(disposable.isDisposed).toBe(true);
    child.dispatchEvent(new Event('contextmenu', { bubbles: true }));
    expect(activate).toHaveBeenCalledTimes(1);

    disposable.dispose();
    expect(disposable.isDisposed).toBe(true);
  });
});

describe('other file type menu plugin', () => {
  /**
   * Build an application whose shell and registry are the stand-ins.
   */
  function createApp(): {
    app: JupyterFrontEnd;
    extensions: Array<{
      factory: string;
      extension: DocumentRegistry.WidgetExtension;
    }>;
  } {
    const { docRegistry, extensions } = createRegistry([]);
    return {
      app: {
        shell: createShell().shell,
        docRegistry
      } as unknown as JupyterFrontEnd,
      extensions
    };
  }

  it('registers no widget extension when the switch is off', async () => {
    const { app, extensions } = createApp();

    await plugin.activate!(app, registryWithSwitch(false));

    expect(extensions).toHaveLength(0);
  });

  it('registers the Editor widget extension when the switch is on', async () => {
    const { app, extensions } = createApp();

    await plugin.activate!(app, registryWithSwitch(true));

    expect(extensions).toHaveLength(1);
    expect(extensions[0].factory).toBe('Editor');
    expect(extensions[0].extension).toBeInstanceOf(ContextMenuFixExtension);
  });
});
