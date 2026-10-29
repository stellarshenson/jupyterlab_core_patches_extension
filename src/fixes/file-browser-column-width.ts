import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { DirListing } from '@jupyterlab/filebrowser';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { isPatchEnabled } from '../patches';

import {
  IColumnSizes,
  isStaleWidth,
  liveWidth,
  sanitiseColumnSizes
} from './file-browser-column-width/columns';

/**
 * The marker set on `DirListing.prototype` once the patch is in place.
 */
const PATCH_MARKER = '__fileBrowserColumnWidthFixPatched';

/**
 * The `DirListing` members the patch reads and wraps.
 */
interface IPatchedListing {
  node: HTMLElement;
  _width: number | null;
  _paddingWidth: number;
  _contentScrollbarWidth: number;
  _columnSizes: Record<string, number | null>;
  _updateColumnSizes(...args: unknown[]): void;
  _setColumnSize(name: string, size: number): void;
  _saveState(): void;
}

/**
 * The live content width of a listing, measured from its own node. Falls back
 * to the cached width while the node has no width of its own.
 */
function panelWidth(listing: IPatchedListing): number {
  const nodeWidth = listing.node.getBoundingClientRect().width;
  if (nodeWidth > 0) {
    return liveWidth(
      nodeWidth,
      listing._paddingWidth,
      listing._contentScrollbarWidth
    );
  }
  return typeof listing._width === 'number' && listing._width > 0
    ? listing._width
    : 0;
}

/**
 * Replace a stale cached content width with the live one, so the stock clamp
 * and the divider use the width the listing actually has.
 */
function refreshCachedWidth(listing: IPatchedListing): void {
  const nodeWidth = listing.node.getBoundingClientRect().width;
  if (nodeWidth <= 0) {
    return;
  }
  const live = liveWidth(
    nodeWidth,
    listing._paddingWidth,
    listing._contentScrollbarWidth
  );
  if (isStaleWidth(listing._width, live)) {
    listing._width = live;
  }
}

/**
 * Sanitise the visible column sizes in place before the stock save path writes
 * them to the state database.
 */
function sanitiseListingSizes(listing: IPatchedListing, width: number): void {
  const sizes = listing._columnSizes;
  if (!sizes) {
    return;
  }
  const current: IColumnSizes = {
    name: typeof sizes.name === 'number' ? sizes.name : NaN,
    is_selected:
      typeof sizes.is_selected === 'number' ? sizes.is_selected : NaN,
    last_modified:
      typeof sizes.last_modified === 'number' ? sizes.last_modified : NaN
  };
  const clean = sanitiseColumnSizes(current, width);
  for (const id of Object.keys(current) as Array<keyof IColumnSizes>) {
    if (typeof sizes[id] === 'number') {
      sizes[id] = clean[id];
    }
  }
}

/**
 * Patch `DirListing.prototype` once. Returns false when it was already patched
 * or when a method it needs is missing.
 */
export function patchDirListing(version: string): boolean {
  const proto = DirListing.prototype as unknown as Record<string, unknown>;
  if (proto[PATCH_MARKER]) {
    return false;
  }
  const required = ['_updateColumnSizes', '_setColumnSize', '_saveState'];
  const missing = required.filter(name => typeof proto[name] !== 'function');
  if (missing.length > 0) {
    console.warn(
      `jupyterlab_file_browser_column_width_fix: ${missing.join(
        ', '
      )} is missing from DirListing in JupyterLab ${version}; the file browser is left untouched.`
    );
    return false;
  }
  const stockUpdateColumnSizes = proto._updateColumnSizes as (
    ...args: unknown[]
  ) => void;
  const stockSetColumnSize = proto._setColumnSize as (
    ...args: unknown[]
  ) => void;
  const stockSaveState = proto._saveState as () => void;

  proto[PATCH_MARKER] = true;
  proto._updateColumnSizes = function (
    this: IPatchedListing,
    ...args: unknown[]
  ): void {
    refreshCachedWidth(this);
    stockUpdateColumnSizes.apply(this, args);
  };
  proto._setColumnSize = function (
    this: IPatchedListing,
    ...args: unknown[]
  ): void {
    refreshCachedWidth(this);
    stockSetColumnSize.apply(this, args);
  };
  proto._saveState = function (this: IPatchedListing): void {
    sanitiseListingSizes(this, panelWidth(this));
    stockSaveState.apply(this);
  };
  return true;
}

/**
 * Initialization data for the jupyterlab_file_browser_column_width_fix extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_file_browser_column_width_fix:plugin',
  description:
    'Keeps the JupyterLab file browser column widths valid when the cached panel width is stale',
  autoStart: true,
  optional: [ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (
      !(await isPatchEnabled(
        settingRegistry,
        'jupyterlab_file_browser_column_width_fix'
      ))
    ) {
      return;
    }

    console.log(
      'JupyterLab extension jupyterlab_file_browser_column_width_fix is activated!'
    );

    try {
      if (patchDirListing(app.version)) {
        console.log(
          'jupyterlab_file_browser_column_width_fix: DirListing patched to recover stale column widths.'
        );
      }
    } catch (reason) {
      console.warn(
        'jupyterlab_file_browser_column_width_fix: could not patch DirListing; the file browser is left untouched.',
        reason
      );
    }
  }
};

export default plugin;
