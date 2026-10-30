# jupyterlab_core_patches_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_core_patches_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_core_patches_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/@stellarshenson/jupyterlab-core-patches-extension.svg)](https://www.npmjs.com/package/@stellarshenson/jupyterlab-core-patches-extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-core-patches-extension.svg)](https://pypi.org/project/jupyterlab-core-patches-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-core-patches-extension)](https://pepy.tech/project/jupyterlab-core-patches-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

One JupyterLab 4 extension carrying ten core patches for the file browser, notebooks, Markdown and terminals.

Every patch has one switch in Settings, all on by default. A switch change applies on the next page reload.

> [!WARNING]
> Uninstall the bundle and the ten discrete packages before installing this one. Removing the bundle alone leaves the ten packages in place, and with both installed every patch runs twice.

## Replace the bundle and the discrete packages

```bash
pip uninstall stellars_jupyterlab_fixes
pip uninstall jupyterlab_change_ui_font_size_fix jupyterlab_file_browser_column_width_fix jupyterlab_jump_to_definition_fix jupyterlab_markdown_switch_tab_scrolling_fix jupyterlab_markdown_syntax_rendering_fix jupyterlab_markdown_viewer_toc_fix jupyterlab_other_file_type_menu_fix jupyterlab_restore_terminals_fix jupyterlab_server_proxy_launcher_fix jupyterlab_terminal_cpr_escape_fix
```

## Features

| Patch                                                           | Problem                                                                                                                                                   | How it solves it                                                                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [UI font size alignment](docs/change-ui-font-size.md)           | File browser icons keep a fixed width while the item text follows the UI font size, so the text is not centered against its icon                          | Adds the `jp-core-patches-change-ui-font-size` body class and scopes CSS that sizes the icon from the UI font size and centers the text against it                 |
| [File browser column width](docs/file-browser-column-width.md)  | The file browser opens with collapsed columns after a saved 24 px layout or a sidebar resize                                                              | Wraps `DirListing.prototype._updateColumnSizes`, `_setColumnSize` and `_saveState` to replace a stale cached width and raise negative sizes to the column minimums |
| [Jump to definition](docs/jump-to-definition.md)                | Jump to definition in a Python notebook misses a package installed only in the kernel environment                                                         | Re-registers `lsp:jump-to-definition` so a Python notebook runs a Jedi analysis in the kernel, guarded once per application                                        |
| [Markdown tab scrolling](docs/markdown-switch-tab-scrolling.md) | A Markdown view loses its scroll position after a tab switch while its images load                                                                        | Connects to `ILabShell.currentChanged` to record the scroll position and restore it every 100 ms until the images settle                                           |
| [Markdown syntax rendering](docs/markdown-syntax-rendering.md)  | Rendered Markdown fenced code blocks show no syntax colours until a CodeMirror editor opens                                                               | Reads the rules from `jupyterHighlightStyle.module.getRules()` and injects them into one style element with a fixed id                                             |
| [Markdown viewer TOC](docs/markdown-viewer-toc.md)              | A table-of-contents entry or in-document anchor link does not move the Markdown Viewer to its heading                                                     | Wraps the renderer and viewer `setFragment` methods to resolve the anchor through `data-jupyter-id` and connects the TOC model to the heading elements             |
| [Other file type menu](docs/other-file-type-menu.md)            | The context menu on a file with no registered type repeats the previous widget's commands, and a file type with no mime types breaks the LSP context menu | Activates the right-clicked editor through a capture-phase `contextmenu` listener and gives every file type without mime types `text/plain`                        |
| [Restore terminals](docs/restore-terminals.md)                  | After a server restart, a restored terminal starts at the server root instead of its last folder                                                          | Reports open terminal names to the server, which stores each folder and re-creates the saved terminals before a browser connects                                   |
| [Server proxy launcher](docs/server-proxy-launcher.md)          | A server-proxy launcher in a custom category shows no icon                                                                                                | Fetches `/server-proxy/servers-info` once and wraps `app.commands.icon` to answer `server-proxy:open` from an icon cache                                           |
| [Terminal CPR escape](docs/terminal-cpr-escape.md)              | An idle terminal shows terminal query responses as literal text, and a terminal restored in a background tab replays its history at 80x24                 | Wraps `TermSocket.on_pty_read` and `TermSocket.open` to filter responses, strip queries from the replay and hold back the size of an unopened xterm                |

## Why one extension

This extension replaces the `stellars_jupyterlab_fixes` metapackage, which installed the same ten patches as ten discrete extensions. One extension loads one bundle in the browser instead of ten, and needs one release per JupyterLab change instead of ten.

```mermaid
%%{init: {'themeVariables': {'fontSize': '8px'}, 'themeCSS': '.cluster-label span, .cluster-label text, .edgeLabel span {color:var(--jp-ui-font-color1, var(--vscode-editor-foreground, var(--fgColor-default, #1f2937))); fill:var(--jp-ui-font-color1, var(--vscode-editor-foreground, var(--fgColor-default, #1f2937)))} @media (prefers-color-scheme: dark){.cluster-label span, .cluster-label text, .edgeLabel span {color:var(--jp-ui-font-color1, var(--vscode-editor-foreground, var(--fgColor-default, #e5e7eb))); fill:var(--jp-ui-font-color1, var(--vscode-editor-foreground, var(--fgColor-default, #e5e7eb)))}}'}}%%
flowchart LR
    subgraph OLD["Before - ten discrete extensions"]
        direction TB
        META[stellars_jupyterlab_fixes<br/>metapackage]:::infra
        TEN[10 discrete extensions<br/>10 labextension entries<br/>10 Extension Manager rows]:::ui
        SCH[3 settings schemas<br/>7 extensions read no settings]:::ui
        BUN[each its own federated bundle<br/>10 bundle loads per page]:::ui
        META --> TEN
        TEN --> SCH
        TEN --> BUN
    end
    subgraph NEW["After - one extension"]
        direction TB
        ONE[1 extension<br/>1 labextension entry<br/>1 settings schema<br/>1 Extension Manager row<br/>1 federated bundle<br/>1 release per JupyterLab change]:::ui
        PLUG[10 patch plugins<br/>1 switch each<br/>old package names kept as plugin ids]:::ui
        ONE --> PLUG
    end
    TEN --> ONE
    ONE --> GAIN[1 labextension bundle, 1 settings load<br/>and 1 release replace<br/>10 bundles, 3 settings loads and 10 releases]:::done
    classDef infra stroke:#6b7280,stroke-width:2px
    classDef ui stroke:#0284c7,stroke-width:2px
    classDef done stroke:#10b981,stroke-width:2px
    style OLD fill:none,stroke:#6b7280,stroke-width:3px
    style NEW fill:none,stroke:#6b7280,stroke-width:3px
```

The diagram shows ten discrete extensions consolidating into one extension: one labextension bundle and one settings load replace ten bundles and three settings loads, and one release per JupyterLab change replaces ten.

## Installation

Requires JupyterLab 4.6 or later.

```bash
pip install jupyterlab_core_patches_extension
```

## Uninstall

```bash
pip uninstall jupyterlab_core_patches_extension
```
