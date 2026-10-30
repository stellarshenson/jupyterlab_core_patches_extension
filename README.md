# jupyterlab_core_patches_extension

[![GitHub Actions](https://github.com/stellarshenson/jupyterlab_core_patches_extension/actions/workflows/build.yml/badge.svg)](https://github.com/stellarshenson/jupyterlab_core_patches_extension/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/@stellarshenson/jupyterlab-core-patches-extension.svg)](https://www.npmjs.com/package/@stellarshenson/jupyterlab-core-patches-extension)
[![PyPI version](https://img.shields.io/pypi/v/jupyterlab-core-patches-extension.svg)](https://pypi.org/project/jupyterlab-core-patches-extension/)
[![Total PyPI downloads](https://static.pepy.tech/badge/jupyterlab-core-patches-extension)](https://pepy.tech/project/jupyterlab-core-patches-extension)
[![JupyterLab 4](https://img.shields.io/badge/JupyterLab-4-orange.svg)](https://jupyterlab.readthedocs.io/en/stable/)
[![Brought To You By KOLOMOLO](https://img.shields.io/badge/Brought%20To%20You%20By-KOLOMOLO-00ffff?style=flat)](https://kolomolo.com)
[![Donate PayPal](https://img.shields.io/badge/Donate-PayPal-blue?style=flat)](https://www.paypal.com/donate/?hosted_button_id=B4KPBJDLLXTSA)

One JupyterLab 4 extension that directly replaces the `stellars_jupyterlab_fixes` metapackage and the ten discrete core-patch extensions it installs. It carries the same ten patches in one labextension entry, so the Extension Manager shows one row and a JupyterLab change needs one release.

Every patch has one switch in Settings, all on by default. A switch change applies on the next page reload.

> [!WARNING]
> Uninstall the bundle and the ten discrete packages before installing this one. Removing the bundle alone leaves the ten packages in place, and with both installed every patch runs twice.

## Replace the bundle and the discrete packages

```bash
pip uninstall stellars_jupyterlab_fixes
pip uninstall jupyterlab_change_ui_font_size_fix jupyterlab_file_browser_column_width_fix jupyterlab_jump_to_definition_fix jupyterlab_markdown_switch_tab_scrolling_fix jupyterlab_markdown_syntax_rendering_fix jupyterlab_markdown_viewer_toc_fix jupyterlab_other_file_type_menu_fix jupyterlab_restore_terminals_fix jupyterlab_server_proxy_launcher_fix jupyterlab_terminal_cpr_escape_fix
```

## Features

| Patch                                                           | What it fixes                                                        |
| --------------------------------------------------------------- | -------------------------------------------------------------------- |
| [UI font size alignment](docs/change-ui-font-size.md)           | File browser item alignment when the UI font size changes            |
| [File browser column width](docs/file-browser-column-width.md)  | File browser columns when the cached width is stale                  |
| [Jump to definition](docs/jump-to-definition.md)                | Jump to definition in notebooks through Jedi                         |
| [Markdown tab scrolling](docs/markdown-switch-tab-scrolling.md) | Scroll position when switching tabs while images load                |
| [Markdown syntax rendering](docs/markdown-syntax-rendering.md)  | Syntax colours in rendered Markdown fenced blocks                    |
| [Markdown viewer TOC](docs/markdown-viewer-toc.md)              | Table of contents and anchor links in the Markdown Viewer            |
| [Other file type menu](docs/other-file-type-menu.md)            | Context menu for unregistered file types and the LSP mimeTypes crash |
| [Restore terminals](docs/restore-terminals.md)                  | Terminal working directories after a workspace restore               |
| [Server proxy launcher](docs/server-proxy-launcher.md)          | SVG icons of server-proxy launchers in custom categories             |
| [Terminal CPR escape](docs/terminal-cpr-escape.md)              | CPR escape text in idle terminals                                    |

## Installation

Requires JupyterLab 4.6 or later.

```bash
pip install jupyterlab_core_patches_extension
```

## Uninstall

```bash
pip uninstall jupyterlab_core_patches_extension
```
