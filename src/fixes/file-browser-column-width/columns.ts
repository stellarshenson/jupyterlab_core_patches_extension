/**
 * Pure helpers for the file browser column width fix.
 *
 * The values restate `DirListing` in `@jupyterlab/filebrowser` 4.6.4: the three
 * columns it always shows, their minimum widths, and its content width formula.
 */

/**
 * The sizes of the three columns a stock listing always shows.
 */
export interface IColumnSizes {
  name: number;
  is_selected: number;
  last_modified: number;
}

/**
 * The minimum widths of the columns a stock listing always shows, copied from
 * `DirListing.columns`.
 */
export const COLUMN_MIN_WIDTHS: IColumnSizes = {
  name: 60,
  is_selected: 18,
  last_modified: 60
};

/**
 * The cached width below which the three columns cannot fit at their minimums.
 * The stock clamp then turns the sizes negative, which is the reported bug.
 */
export const MINIMUM_LAYOUT_WIDTH =
  COLUMN_MIN_WIDTHS.name +
  COLUMN_MIN_WIDTHS.is_selected +
  COLUMN_MIN_WIDTHS.last_modified;

/**
 * The stock content width, copied from `DirListing._computeContentWidth`: the
 * node width less twice the listing padding and the scrollbar width.
 */
export function liveWidth(
  nodeWidth: number,
  paddingWidth: number,
  scrollbarWidth: number
): number {
  return nodeWidth - paddingWidth * 2 - scrollbarWidth;
}

/**
 * Whether a cached content width is stale: non-positive, or too small to lay
 * out the visible columns at their minimum widths.
 */
export function isStaleWidth(
  cachedWidth: number | null,
  panelWidth: number
): boolean {
  if (
    cachedWidth === null ||
    !Number.isFinite(cachedWidth) ||
    cachedWidth <= 0
  ) {
    return true;
  }
  return cachedWidth < Math.min(panelWidth, MINIMUM_LAYOUT_WIDTH);
}

/**
 * Raise negative and collapsed column sizes to a layout that fits the panel.
 * The minimum raise runs at any width; only the Name growth needs a measured
 * panel.
 */
export function sanitiseColumnSizes(
  sizes: IColumnSizes,
  panelWidth: number
): IColumnSizes {
  const result: IColumnSizes = { ...sizes };
  for (const id of Object.keys(COLUMN_MIN_WIDTHS) as Array<
    keyof IColumnSizes
  >) {
    if (!Number.isFinite(result[id]) || result[id] < COLUMN_MIN_WIDTHS[id]) {
      result[id] = COLUMN_MIN_WIDTHS[id];
    }
  }
  const total = result.name + result.is_selected + result.last_modified;
  if (result.name <= COLUMN_MIN_WIDTHS.name && panelWidth > total) {
    // A Name column pinned at its minimum hides the names while the panel has room.
    result.name += panelWidth - total;
  }
  return result;
}
