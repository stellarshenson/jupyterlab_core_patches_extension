# Restore terminals

Terminals reopen in the folder they were last in after the Jupyter server restarts. This page documents the patch inside `jupyterlab_core_patches_extension`, the direct replacement for the discrete `jupyterlab_restore_terminals_fix` package and for its entry in the `stellars_jupyterlab_fixes` bundle. Uninstall the discrete package and the bundle before installing the combined extension, because two installed copies apply the patch twice.

The frontend reports the names of the terminals with an open tab to the server every 15 seconds and again 2 and 5 seconds after one opens. The server resolves each terminal's folder from the process tree under its pty and stores it. At the next server startup it re-creates the saved terminals before any browser connects, so the stock workspace restore attaches to a running session in its saved folder instead of starting a shell at the server root.

**Switch** - `jupyterlab_restore_terminals_fix`, boolean, default `true`. The frontend reads the switch on activation; a change applies on the next page reload. The server reads the switch when the server starts, before the startup re-creation.

**Plugin id** - `jupyterlab_restore_terminals_fix:plugin`

**Patched member** - no prototype member is replaced. The plugin adds a `widgetAdded` connection and a 15 second interval that posts to `POST <base_url>/jupyterlab-restore-terminals-fix/state`. The server adds the routes `GET .../cwd/<name>`, `GET .../cwds` and `POST .../state`, and re-creates saved terminals during startup.

**Guard** - the source has no double-patch guard. The port adds the window key `__jp_restore_terminals_fix__`; a second activation returns before it connects another `widgetAdded` handler or starts a second interval. The server half is idempotent without a guard: `prepopulate` skips a name that is already running, a repeated `POST /state` replaces the stored state with the same values, and a repeated route registration leaves one handler for each path.

**Source** - `jupyterlab_restore_terminals_fix` v0.9.30: `src/index.ts`, `src/request.ts`, `jupyterlab_restore_terminals_fix/routes.py` and the startup block of `jupyterlab_restore_terminals_fix/__init__.py`. The patch logic is ported unchanged. The switch gate, the settings source, the import paths and the public server entry names are the only changes. The saved-workspaces folder assignment moved from the package entry point into `setup_handlers`, because the combined entry point is composed by the integrator.

**Jest test** - `src/__tests__/restore-terminals.spec.ts`. Covers the plugin metadata, the 2 and 5 second report after a terminal opens, the 15 second periodic report, the empty report when no tab is open, the switch gate and the second-activation no-op.

**Galata test** - `ui-tests/tests/restore-terminals.spec.ts`. With the switch `false` a newly opened terminal produces no `POST /state`. With the switch `true` the same scenario posts the terminal name within 5 seconds. The startup restore needs a server restart, so Galata proves the recording, which is the patch's own marker; the restore itself is covered by `jupyterlab_core_patches_extension/tests/test_restore_terminals.py`, which re-creates a saved terminal when the extension loads at startup, and `jupyterlab_core_patches_extension/tests/test_restore_terminals_restart.py`, which re-creates it across a real server restart.

## Behaviour

- **Record on open** - a terminal that opens is reported at 2 and 5 seconds, which covers the pty spawn delay
- **Record on change** - the 15 second interval captures a `cd` typed between opens
- **Empty report** - with no terminal tab open the frontend posts an empty list, so the last closed tab leaves no saved entry
- **Deepest folder** - the server saves the folder of the deepest process in the terminal's process tree, preferring a shell at equal depth
- **Workspace terminals** - names held in any saved workspace layout keep their previous folder even when no open page reports them
- **Startup re-creation** - saved terminals are created one second after the server extension loads, before any browser connects, so the stock restore attaches instead of starting a new shell
- **Linux** - folders are read from `/proc` without starting a subprocess
- **macOS** - folders come from `pgrep` and `lsof`

## Server routes

- `GET <base_url>/jupyterlab-restore-terminals-fix/cwd/<name>` - the folder of one terminal; 404 when the name is not running
- `GET <base_url>/jupyterlab-restore-terminals-fix/cwds` - the folders of every running terminal
- `POST <base_url>/jupyterlab-restore-terminals-fix/state` - body `{"names": [...]}`; resolves and replaces the saved state
- **No terminal service** - each route answers 503 when the server has no `terminal_manager`

## Limitations

- The switch is read once. A change applies on the next page reload; the startup re-creation reads it on the next server start.
- Turning the switch off does not terminate terminals that an earlier server start already re-created.
- The restored terminal opens without a typed `cd` command; the server creates the session in the folder directly.

## Members

| Member                      | File                                                            | Purpose                                                              |
| --------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `default` (`plugin`)        | `src/fixes/restore-terminals.ts`                                | Declares the plugin id, reads the switch and wires the reports       |
| `SWITCH_KEY`                | `src/fixes/restore-terminals.ts`                                | The settings key the gate reads                                      |
| `PATCH_MARKER`              | `src/fixes/restore-terminals.ts`                                | Window key that makes a second activation a no-op                    |
| `POLL_INTERVAL_MS`          | `src/fixes/restore-terminals.ts`                                | Periodic report interval, 15 s                                       |
| `OPEN_REPORT_DELAYS_MS`     | `src/fixes/restore-terminals.ts`                                | Report delays after a terminal opens, 2 s and 5 s                    |
| `reportLayoutTerminals`     | `src/fixes/restore-terminals.ts`                                | Collects the tracker's terminal names and posts them                 |
| `requestAPI`                | `src/fixes/restore-terminals/request.ts`                        | Calls a route under the `jupyterlab-restore-terminals-fix` namespace |
| `SWITCH_KEY`                | `jupyterlab_core_patches_extension/server/restore-terminals.py` | The settings key the server gate reads                               |
| `KNOWN_SHELLS`              | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Shell names preferred at equal process depth                         |
| `TerminalCwdHandler`        | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Serves the folder of one terminal                                    |
| `AllTerminalCwdsHandler`    | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Serves the folders of every running terminal                         |
| `TerminalStateHandler`      | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Resolves the reported terminals and replaces the saved state         |
| `setup_handlers`            | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Stores the workspaces folder and registers the three routes          |
| `prepopulate`               | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Reads the switch and schedules the startup re-creation               |
| `_prepopulate_terminals`    | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Creates each saved terminal that is not running                      |
| `_workspaces_dir`           | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Finds the LabApp workspaces folder or its default                    |
| `_get_process_comm`         | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Reads one process's command name                                     |
| `_get_direct_children`      | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Lists the direct children of a process, including thread forks       |
| `_collect_process_tree`     | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Walks the process tree with depth and shell flags                    |
| `_is_valid_cwd`             | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Rejects empty, relative and pseudo-filesystem folders                |
| `_get_cwd_linux`            | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Reads a folder from `/proc/<pid>/cwd`                                |
| `_get_pwd_from_environ`     | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Reads `PWD` from `/proc/<pid>/environ`                               |
| `_get_cwd_macos`            | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Reads a folder with `lsof`                                           |
| `_try_get_cwd`              | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Picks the platform-specific folder lookup                            |
| `_get_process_cwd`          | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Returns the deepest valid folder in the tree                         |
| `_to_relative_cwd`          | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Expresses a folder relative to the server root                       |
| `_get_terminal_cwd`         | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Builds the folder record of one terminal                             |
| `_state_file`               | `jupyterlab_core_patches_extension/server/restore-terminals.py` | The state path for one server root                                   |
| `_load_state`               | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Reads the saved state, empty on any failure                          |
| `_save_state`               | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Writes the state atomically                                          |
| `_workspace_terminal_names` | `jupyterlab_core_patches_extension/server/restore-terminals.py` | Reads terminal names from the saved workspace files                  |
