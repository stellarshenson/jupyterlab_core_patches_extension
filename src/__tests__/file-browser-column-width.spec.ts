/**
 * Guards that the DirListing patch is installed and that its wrappers act on a
 * stale cached width. The real @jupyterlab/filebrowser is replaced because it
 * pulls untransformed ESM through @jupyter/react-components.
 */
jest.mock('@jupyterlab/filebrowser', () => ({
  DirListing: class {
    _updateColumnSizes(): void {
      // replaced by the test's spy
    }
    _setColumnSize(): void {
      // replaced by the test's spy
    }
    _saveState(): void {
      // replaced by the test's spy
    }
  }
}));

import { DirListing } from '@jupyterlab/filebrowser';

import {
  COLUMN_MIN_WIDTHS,
  isStaleWidth,
  sanitiseColumnSizes
} from '../fixes/file-browser-column-width/columns';
import { patchDirListing } from '../fixes/file-browser-column-width';

describe('isStaleWidth', () => {
  it('flags a cached width that cannot fit the column minimums', () => {
    expect(isStaleWidth(24, 250)).toBe(true);
    expect(isStaleWidth(140, 250)).toBe(false);
  });

  it('flags a zero, negative or missing cached width', () => {
    expect(isStaleWidth(0, 250)).toBe(true);
    expect(isStaleWidth(-48, 250)).toBe(true);
    expect(isStaleWidth(null, 250)).toBe(true);
  });
});

describe('sanitiseColumnSizes', () => {
  it('leaves a healthy set unchanged', () => {
    const sizes = { name: 149, is_selected: 18, last_modified: 83 };
    expect(sanitiseColumnSizes(sizes, 250)).toEqual(sizes);
  });

  it('sanitises negative and collapsed sizes against the panel width', () => {
    const clean = sanitiseColumnSizes(
      { name: 24, is_selected: 18, last_modified: -48 },
      250
    );
    expect(clean.is_selected).toBeGreaterThanOrEqual(
      COLUMN_MIN_WIDTHS.is_selected
    );
    expect(clean.last_modified).toBeGreaterThanOrEqual(
      COLUMN_MIN_WIDTHS.last_modified
    );
    expect(clean.name).toBeGreaterThan(COLUMN_MIN_WIDTHS.name);
  });

  it('raises a negative width to a valid value', () => {
    const clean = sanitiseColumnSizes(
      { name: 120, is_selected: -5, last_modified: 90 },
      250
    );
    expect(clean.is_selected).toBe(COLUMN_MIN_WIDTHS.is_selected);
  });

  it('raises the minimums even when the panel width is zero', () => {
    expect(
      sanitiseColumnSizes({ name: 24, is_selected: 18, last_modified: -48 }, 0)
    ).toEqual({ name: 60, is_selected: 18, last_modified: 60 });
  });
});

interface IFakeListing {
  node: { getBoundingClientRect(): { width: number } };
  _width: number | null;
  _paddingWidth: number;
  _contentScrollbarWidth: number;
  _columnSizes: Record<string, number | null>;
  _updateColumnSizes(): void;
  _setColumnSize(name: string, size: number): void;
  _saveState(): void;
}

/**
 * A listing whose node measures 300 px: the live content width is
 * 300 - 2 * 12 - 17 = 259.
 */
function fakeListing(): IFakeListing {
  const proto = DirListing.prototype as any;
  return {
    node: { getBoundingClientRect: () => ({ width: 300 }) },
    _width: 24,
    _paddingWidth: 12,
    _contentScrollbarWidth: 17,
    _columnSizes: { name: 24, is_selected: 18, last_modified: -48 },
    _updateColumnSizes: proto._updateColumnSizes,
    _setColumnSize: proto._setColumnSize,
    _saveState: proto._saveState
  };
}

describe('patchDirListing', () => {
  const proto = DirListing.prototype as any;
  const stockUpdate = jest.spyOn(proto, '_updateColumnSizes');
  const stockSet = jest.spyOn(proto, '_setColumnSize');
  const stockSave = jest.spyOn(proto, '_saveState');

  beforeAll(() => {
    expect(patchDirListing('4.6.4')).toBe(true);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is installed only once', () => {
    const installed = proto._updateColumnSizes;
    expect(patchDirListing('4.6.4')).toBe(false);
    expect(proto._updateColumnSizes).toBe(installed);
  });

  it('replaces a stale cached width on update', () => {
    const listing = fakeListing();
    listing._updateColumnSizes();
    expect(listing._width).toBe(259);
    expect(stockUpdate).toHaveBeenCalledTimes(1);
  });

  it('replaces a stale cached width on a divider resize', () => {
    const listing = fakeListing();
    listing._setColumnSize('name', 120);
    expect(listing._width).toBe(259);
    expect(stockSet).toHaveBeenCalledWith('name', 120);
  });

  it('leaves a healthy cached width alone', () => {
    const listing = fakeListing();
    listing._width = 200;
    listing._updateColumnSizes();
    expect(listing._width).toBe(200);
  });

  it('sanitises negative and collapsed sizes before saving', () => {
    const listing = fakeListing();
    listing._saveState();
    expect(listing._columnSizes.is_selected as number).toBeGreaterThanOrEqual(
      18
    );
    expect(listing._columnSizes.last_modified as number).toBeGreaterThanOrEqual(
      60
    );
    expect(listing._columnSizes.name as number).toBeGreaterThan(60);
    expect(stockSave).toHaveBeenCalledTimes(1);
  });
});
