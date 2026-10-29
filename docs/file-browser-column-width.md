# File browser column width

Recovers a stale cached content width in the JupyterLab file browser before the stock column clamp turns the column sizes negative. The Name column and the item text stay visible after a saved 24 px layout or a sidebar resize. This page documents the `file-browser-column-width` patch inside `jupyterlab_core_patches_extension`, the direct replacement for the discrete `jupyterlab_file_browser_column_width_fix` package and for its entry in the `stellars_jupyterlab_fixes` bundle. Uninstall the discrete package and the bundle before installing the combined extension, because two installed copies register the same plugin id.

- **Switch** - `jupyterlab_file_browser_column_width_fix`, boolean, default `true`
- **Plugin id** - `jupyterlab_file_browser_column_width_fix:plugin`
- **Patched member** - `DirListing.prototype._updateColumnSizes`, `DirListing.prototype._setColumnSize` and `DirListing.prototype._saveState`
- **Guard** - `DirListing.prototype.__fileBrowserColumnWidthFixPatched`, set before the wrappers are installed
- **Source** - `/home/lab/workspace/private/jupyterlab/jupyterlab_file_browser_column_width_fix`
- **Jest test** - `src/__tests__/file-browser-column-width.spec.ts`
- **Galata test** - `ui-tests/tests/file-browser-column-width.spec.ts`

## Behaviour

The stock `DirListing` trusts its cached `_width` when it clamps column sizes. A stale 24 px cache makes the clamp return negative sizes, and the saved state keeps them, so the file browser opens with collapsed columns.

- **On update** - `_updateColumnSizes` and `_setColumnSize` first replace a stale cached `_width` with the live content width
- **On save** - `_saveState` raises negative and collapsed sizes to the column minimums before the stock save writes them to the state database
- **Stale test** - a cached width is stale when it is not a positive finite number, or below `min(live width, 138 px)`, where 138 px is 60 + 18 + 60
- **Name growth** - when the Name column sits at its 60 px minimum and the panel is wider than the three minimums, the save path gives the spare width to Name
- **Panel fallback** - when the node measures 0 px, the save path uses the cached `_width`, then 0

## Port notes

- **Server part** - none
- **Scaffold removed** - the source's `hello` route and `src/request.ts` are not ported
- **CSS** - the source has no CSS, so the patch adds no body class and no stylesheet
- **Settings source** - the source read its own plugin schema
- **Shared switch** - this port reads `jupyterlab-core-patches-extension:plugin` through `isPatchEnabled`

## Members

| Member                 | Kind                                          | Purpose                                                                      |
| ---------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| `patchDirListing`      | exported function                             | Patch `DirListing.prototype` once and report whether it patched              |
| `plugin`               | default export, `JupyterFrontEndPlugin<void>` | Gate on the switch, then install the patch                                   |
| `PATCH_MARKER`         | constant                                      | Prototype flag that makes a second patch a no-op                             |
| `IPatchedListing`      | interface                                     | The `DirListing` members the wrappers read and call                          |
| `panelWidth`           | helper function                               | Live content width from the node; cached `_width` when the node has no width |
| `refreshCachedWidth`   | helper function                               | Replace a stale `_width` with the live content width                         |
| `sanitiseListingSizes` | helper function                               | Sanitise `_columnSizes` in place before the stock save                       |
| `IColumnSizes`         | exported interface                            | Sizes of the name, is_selected and last_modified columns                     |
| `COLUMN_MIN_WIDTHS`    | exported constant                             | Minimum widths 60, 18 and 60 px                                              |
| `MINIMUM_LAYOUT_WIDTH` | exported constant                             | The 138 px sum of the three minimum widths                                   |
| `liveWidth`            | exported function                             | Node width less twice the padding and the scrollbar width                    |
| `isStaleWidth`         | exported function                             | Whether a cached width cannot lay out the visible columns                    |
| `sanitiseColumnSizes`  | exported function                             | Raise invalid sizes to the minimums and grow Name to fill the panel          |

## Limits

- **Cached width only** - the patch repairs `_width` and `_columnSizes`
- **Stock logic untouched** - the clamp and the divider logic stay as JupyterLab ships them
- **Double patch** - a second `patchDirListing` call returns `false` and changes nothing
- **Activation gate** - the plugin reads the switch once at activation, so a switch change needs a page reload
- **JupyterLab version** - the wrapped members are private `DirListing` members, so a future JupyterLab that renames one gets a console warning and no patch
