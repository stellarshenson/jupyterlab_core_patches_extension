# Jump to definition

This page documents the port of the discrete `jupyterlab_jump_to_definition_fix` package into `jupyterlab_core_patches_extension`. The combined extension is a direct replacement for the discrete package and for its entry in the `stellars_jupyterlab_fixes` bundle. Uninstall the discrete package before installing the combined extension, because two installed copies override the same command.

The patch replaces the `lsp:jump-to-definition` action in Python notebooks with a Jedi analysis that runs inside the notebook kernel. Definitions resolve from the kernel's `sys.path`, so a package installed in the kernel environment is found even when JupyterLab's own environment does not contain it. A definition inside the notebook moves the cursor to the defining cell.

**Switch** - `jupyterlab_jump_to_definition_fix`, boolean, default `true`. The plugin reads the switch on activation; a change applies on the next page reload.

**Plugin id** - `@stellarshenson/jupyterlab-core-patches-extension:jump-to-definition`

**Patched member** - the `lsp:jump-to-definition` command descriptor. The plugin re-registers the command with a dispatcher and keeps the stock label and icon. The plugin also registers `notebook:jump-to-definition-kernel` and binds `Accel B` in `.jp-Notebook.jp-mod-editMode`.

**Guard** - `installLspCommandOverride` keeps the source's `lspCommandOverridden` flag and adds a module-level `WeakSet` keyed by the application. The first call for an application captures the stock command; a second call returns before it touches the registry. When LSP loads after the plugin, the `added` event of `commandChanged` triggers the same capture.

**Source** - `jupyterlab_jump_to_definition_fix` v1.0.69: `src/index.ts`, `src/request.ts`, `jupyterlab_jump_to_definition_fix/routes.py`. The patch logic is ported unchanged; the switch gate, the settings source and the import paths are the only changes.

**Jest test** - `src/__tests__/jump-to-definition.spec.ts`. Covers the joined-source line arithmetic, the dispatch to the kernel command, the delegation to the stock command and the second-call no-op.

**Galata test** - `ui-tests/tests/jump-to-definition.spec.ts`. With the switch `false` the kernel command is absent after a reload. With the switch `true` a one-cell notebook moves the cursor from the call line to the definition line.

## Members

| Member                      | File                                                             | Purpose                                                                              |
| --------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `default` (`plugin`)        | `src/fixes/jump-to-definition.ts`                                | Registers the kernel command, the key binding and the LSP override behind the switch |
| `SWITCH_KEY`                | `src/fixes/jump-to-definition.ts`                                | The settings key the plugin reads                                                    |
| `isPythonNotebook`          | `src/fixes/jump-to-definition.ts`                                | Returns `true` for a Python notebook with a running kernel                           |
| `INotebookCell`             | `src/fixes/jump-to-definition/lines.ts`                          | The cell shape the line arithmetic reads                                             |
| `collectCellSources`        | `src/fixes/jump-to-definition/lines.ts`                          | Joins every code cell source with a newline                                          |
| `absoluteLine`              | `src/fixes/jump-to-definition/lines.ts`                          | Converts a cell cursor to a 1-based line in the joined source                        |
| `locateAbsoluteLine`        | `src/fixes/jump-to-definition/lines.ts`                          | Maps a joined-source line back to a widget index and a line                          |
| `STOCK_LSP_COMMAND_ID`      | `src/fixes/jump-to-definition/override.ts`                       | The stock LSP command id                                                             |
| `KERNEL_JUMP_COMMAND_ID`    | `src/fixes/jump-to-definition/override.ts`                       | The kernel jump command id                                                           |
| `overriddenApps`            | `src/fixes/jump-to-definition/override.ts`                       | Applications already overridden, one entry per application                           |
| `installLspCommandOverride` | `src/fixes/jump-to-definition/override.ts`                       | Captures and re-registers the stock command once per application                     |
| `overrideLSPCommand`        | `src/fixes/jump-to-definition/override.ts`                       | The capture step, guarded by `lspCommandOverridden`                                  |
| `requestAPI`                | `src/fixes/jump-to-definition/request.ts`                        | Calls the server route and parses the JSON response                                  |
| `INTROSPECTION_CODE`        | `jupyterlab_core_patches_extension/server/jump_to_definition.py` | The Jedi template executed in the kernel                                             |
| `IntrospectionCodeHandler`  | `jupyterlab_core_patches_extension/server/jump_to_definition.py` | Serves the template at the route                                                     |
| `setup_handlers`            | `jupyterlab_core_patches_extension/server/jump_to_definition.py` | Registers the route with the server                                                  |

## Server route

The route keeps the path of the source package: `GET <base_url>/jupyterlab-jump-to-definition-fix/introspection-code` returns `{"code": "<template>"}`. The template holds four placeholders, `__NOTEBOOK_SOURCE__`, `__CURSOR_LINE__`, `__CURSOR_COLUMN__` and `__NOTEBOOK_PATH__`, which the frontend replaces before it sends the code to the kernel.

The scaffold `hello` route and its silent frontend check are dropped. The combined extension registers only the route the patch uses.

## Behaviour

- **Python notebook** - `lsp:jump-to-definition` and `Accel B` run the Jedi analysis in the kernel
- **Other widget** - the re-registered command delegates to the captured stock descriptor
- **Definition in the notebook** - the cursor moves to the defining cell and line; no file is opened
- **Definition in a module** - the kernel cwd and the notebook path give the server root; the file opens at the definition line
- **Jedi absent** - the kernel returns an error message that the frontend shows in a dialog

## Limitations

- The kernel must run Python and have `jedi` installed. An ipykernel environment includes Jedi through IPython; a kernel without it shows the install message.
- The switch is read once at activation. A changed value applies after a page reload.
- `jupyterlab-lsp` is not installed in the test environment, so the Galata test proves the switch through the absence of the kernel command. The stock `lsp:jump-to-definition` command is absent from that environment.
