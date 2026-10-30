# Other file type menu

Repairs the context menu for files with no registered file type and stops the LSP adapter from crashing on file types that have no mime types. This page documents the `other-file-type-menu` patch in `jupyterlab_core_patches_extension`, the direct replacement for the discrete `jupyterlab_other_file_type_menu_fix` package and for that package's entry in the `stellars_jupyterlab_fixes` bundle. Uninstall the bundle and the discrete package before installing the combined extension, because two installed copies register the widget extension twice.

- **Switch** - `jupyterlab_other_file_type_menu_fix`, boolean, default `true`; a change applies on the next page reload
- **Plugin id** - `jupyterlab_other_file_type_menu_fix:plugin`
- **Patched member** - a capture-phase `contextmenu` listener on the node of every widget created by the `Editor` factory, and the `mimeTypes` array of every document registry file type that has none
- **Guard** - `ContextMenuFixExtension._patched`, the source's flag: the registry scan runs on the first `createNew` call and every later call skips it
- **Source** - `jupyterlab_other_file_type_menu_fix` v1.0.14, `src/index.ts`; the patch logic is ported unchanged, with the switch gate, the settings source and the import paths as the only changes
- **Jest test** - `src/__tests__/other-file-type-menu.spec.ts`
- **Galata test** - `ui-tests/tests/other-file-type-menu.spec.ts`

## Behaviour

The plugin reads its switch through `isPatchEnabled` and returns before it registers anything when the switch is off. When the switch is on, it logs the activation and registers one `DocumentRegistry.WidgetExtension` on the `Editor` factory.

### Context menu

`DocumentRegistry.getFileTypesForPath()` returns no entry for `LICENSE`, `.gitignore`, `Dockerfile` and other paths with no registered extension or pattern. The file still opens in a `FileEditor`, but the widget may not be the shell's `currentWidget` when the context menu fires. Lumino resolves the menu commands against `currentWidget`, so the menu repeats the previous widget's commands: the items are inert against the visible editor and the hover highlight does not match.

- **Listener** - the widget extension attaches `contextmenu` on the widget node in the capture phase
- **Activation** - the listener calls `shell.activateById(widget.id)` before the event reaches the document-level JupyterLab handler
- **Resolution** - the right-clicked editor is current before the menu resolves its commands
- **Scope** - the listener is attached to every editor widget, so the repair covers registered and unregistered file types

### LSP mime types

Icon extensions such as vscode-icons register file types with patterns but without a `mimeTypes` array. The LSP adapter calls `getFileTypeForModel()` and reads `mimeTypes[0]` from the returned type. The `undefined` access throws a `TypeError` that disposes the virtual document and breaks every LSP context menu item.

- **Scan time** - the first editor widget creation
- **Repair** - a file type whose `mimeTypes` is missing or empty receives `['text/plain']`
- **Untouched** - a file type with at least one mime type keeps its array

## Members

| Member                              | Kind                          | Purpose                                                                                            |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `plugin` (default export)           | `JupyterFrontEndPlugin<void>` | Reads the switch, logs activation and registers the widget extension on the `Editor` factory       |
| `ContextMenuFixExtension`           | exported class                | Implements `DocumentRegistry.WidgetExtension`; patches the registry once and attaches the listener |
| `ContextMenuFixExtension._patched`  | private field                 | Double-patch guard; the registry scan runs once per extension instance                             |
| `ContextMenuFixExtension.createNew` | method                        | Patches the file types and returns the disposable that removes the listener                        |

## Port notes

- **Server part** - none; the source `jupyterlab_other_file_type_menu_fix/__init__.py` only declares the labextension path
- **Scaffold removed** - the source Jest test held a `1 + 1` placeholder; the port replaces it with the tests below
- **CSS** - the source `style/base.css` holds only a comment, so the patch adds no stylesheet and no body class
- **Settings source** - the source read no settings; the port gates on the shared `@stellarshenson/jupyterlab-core-patches-extension:plugin` schema through `isPatchEnabled`
- **Double registration** - a still-installed old package adds a second listener and repeats the mime type assignment; both effects are idempotent, so the visible result is unchanged

## Test approach

The Jest test covers the mime type repair, the registry scan running once across two widget creations, the capture-phase listener, the dispose path and both switch states of the plugin.

The Galata test dispatches a `contextmenu` event on a non-current editor instead of right-clicking it. A real right-click can move focus and update the shell's focus tracker before the menu resolves, which would hide whether the capture listener did the activation. The assertion is the shell's current widget before and after the dispatch, with the switch off, on and back on. The rendered menu content is not asserted, because it depends on the commands the installed extensions register.
