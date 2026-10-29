# jupyterlab_core_patches_extension

One JupyterLab 4 extension that carries the ten Stellars fixes and lets each one be switched off from Settings. It replaces ten separately installed packages, so the Extension Manager shows one row instead of ten, and a JupyterLab change means one release instead of ten.

## The ten fixes

Each source project sits beside this one under `/home/lab/workspace/private/jupyterlab/`. Port the patch logic unchanged; only the packaging changes.

| Fix                                          | What it patches                                                      |
| -------------------------------------------- | -------------------------------------------------------------------- |
| jupyterlab_change_ui_font_size_fix           | file browser item alignment when the UI font size changes            |
| jupyterlab_file_browser_column_width_fix     | file browser columns when the cached width is stale                  |
| jupyterlab_jump_to_definition_fix            | jump to definition in notebooks through Jedi                         |
| jupyterlab_markdown_switch_tab_scrolling_fix | scroll position when switching tabs while images load                |
| jupyterlab_markdown_syntax_rendering_fix     | syntax colours in rendered Markdown fenced blocks                    |
| jupyterlab_markdown_viewer_toc_fix           | table of contents and anchor links in the Markdown Viewer            |
| jupyterlab_other_file_type_menu_fix          | context menu for unregistered file types and the LSP mimeTypes crash |
| jupyterlab_restore_terminals_fix             | terminal working directories after a workspace restore               |
| jupyterlab_server_proxy_launcher_fix         | SVG icons of server-proxy launchers in custom categories             |
| jupyterlab_terminal_cpr_escape_fix           | CPR escape text in idle terminals                                    |

## Behaviour

- One extension entry, one settings schema, ten plugins inside the package
- Each plugin keeps its old package name as its plugin id
- The schema holds one boolean per fix, default true
- An `activate` whose flag is false returns before patching
- A flag change applies on the next page reload
- Patching twice must not happen when an old package is still installed: detect an existing patch and skip

## Scope for the first milestone

- Port all ten fixes and their existing tests
- The settings page with ten switches
- One Galata test per fix proving the switch turns it off
- No new fixes, no behaviour change to the ported patch logic

## README

The README states, in its opening paragraph, that this extension is a direct replacement for the discrete fix packages, and names them as the table above names them. It also states that those packages must be uninstalled first, because a machine with both installed applies every patch twice.

## Assumed default

The ten old packages stay published and frozen. This package does not depend on them and does not uninstall them.
