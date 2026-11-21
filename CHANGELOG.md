# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

## [1.0.39] - 2026-11-22

### Added

- A `reload` argument for `server-proxy:open`: with `reload: true` and the `id` of a tab already open, the tab's frame loads the new `url`, resolved against the base URL, and the tab is activated; one tab stays open and the lab page does not reload. A call without `reload`, a call for a tab that is not open, and every call with the `jupyterlab_server_proxy_launcher_fix` switch off run stock `server-proxy:open` unchanged

### Changed

- The `jupyterlab_server_proxy_launcher_fix` switch title and description, and the plugin description, name both the launcher icons and the reload argument; `docs/server-proxy-launcher.md` and the README row describe the reload argument, the wrapped `commands.execute` method and the open-tab lookup by `id`

## [1.0.38] - 2026-11-18

### Added

- A `trash-put` console script from `[project.scripts]`: a file deleted on a mount other than the home trash's is renamed into `<mount>/.Trash-<uid>` with its `.trashinfo`, so a workspace delete neither copies into the home trash nor stalls; a same-mount path, an option, a dot spelling, a missing path and an unusable mount trash pass unchanged to `/usr/bin/trash-put` with its exit code; the environment bin precedes `/usr/bin` on the lab PATH; the script ships with `--help` and its agent skill in the wheel

### Changed

- `docs/file-delete-trash.md` states in its Limits that a stock `trash-put` delete lands in the home trash at `~/.local/share/Trash` under the freedesktop spec because the bind mounts report one device, while this patch covers the contents-manager path the file browser uses, which lands in `<mount>/.Trash-<uid>`; the trackers record `DEF-PATCH-9-TRASH-ROUTING` rejected as by design and the 2026-11-18 one-delete verification on `ACC-PATCH-34-MOUNT-TRASH`

## [1.0.37] - 2026-11-16

### Fixed

- A terminal tab that JupyterLab stopped retrying after 7 failed reconnects, after a laptop sleep or a network drop, no longer keeps its last screen and drops typed text: the terminal CPR escape patch reconnects it when the page is shown again, when the browser is back online, or when you type into it, and the text typed while it was disconnected is sent after the reconnect. The `jupyterlab_terminal_cpr_escape_fix` switch covers it; no setting is added
- The file-delete Galata test finds the Move to Trash button by its label, so it passes when the advanced file browser extension replaces the delete dialog

### Changed

- The terminal CPR escape and restore terminals patches act on terminal sessions through one shared frontend module (one handler per page, one `send` wrapper per terminal session, one owner of the terminal page listeners and timers) and one server helper for the shell names and the `/proc` readers; both switches and every settings key stay as they were

## [1.0.32] - 2026-11-14

### Fixed

- The release lint step no longer rewrites `src/__tests__/` to `src/**tests**/` in the acceptance-criteria tracker: `.prettierignore` excludes `docs/acc-crit*.md`, `docs/defects*.md` and `docs/pm-hand-edits.md`, which `pm-tools check` validates; the six damaged tracker lines read their written text again

## [1.0.31] - 2026-11-13

### Added

- A file-browser delete no longer stops the server from answering: the new `jupyterlab_file_delete_trash_fix` switch, on by default, runs the trash call in a worker thread under one lock and renames an item on another mount into that mount's `.Trash-<uid>` folder instead of copying it into the home trash
- When the mount trash cannot be found or created, the delete falls back to the stock `send2trash`; a failed rename answers 400 and moves nothing

### Changed

- The README, the plugin description and the schema list twelve patches
- The local Makefile follows the reference 1.49: `make publish` installs before it tests

## [1.0.28] - 2026-11-13

### Changed

- Skip the PayPal link in the link check

### Fixed

- Read the server-side switches from the folder JupyterLab writes
- Keep the execution count on a jump and release the scroll guard on a failed image

## [1.0.24] - 2026-11-11

### Fixed

- A closed terminal WebSocket no longer stops output delivery to the remaining clients: the CPR wrapper contains WebSocketClosedError from the original on_pty_read handler so terminado's client loop continues; the switch-off path keeps stock behaviour
- Four pytest tests cover the guard: a closed client is skipped, other errors still propagate, the switch-off path is unchanged, and all-closed clients raise nothing

## [1.0.23] - 2026-11-06

### Changed

- No code change since 1.0.22: this release publishes the same web tab scroll patch and terminal-CPR repair with the changelog and journal committed

## [1.0.22] - 2026-11-06

### Added

- A web tab keeps its scroll position across a tab switch, a frame refresh and a page reload; the new `jupyterlab_web_switch_tab_scrolling_fix` switch, on by default, records the visible offset, restores it on reselect, on the frame load and from a per-widget hide snapshot, and keeps it per URL in sessionStorage for a page reload; same-origin frames only
- The ui-tests suite runs headed under xvfb with full Chromium in CI, because only a headed browser resets the frame scroll this patch restores

### Changed

- The README, the plugin description and the schema list eleven patches

## [1.0.21] - 2026-11-03

### Fixed

- A terminal whose session was not running when the page loaded, such as one the page starts new, gets its fitted size at its first show without the one-column repaint step
- The server no longer steps a terminal session on its first attach; every later attach, the reattach after a page reload included, keeps the step, so the first command a new session runs, such as one a session bookmark sends, reads the full width

## [1.0.18] - 2026-10-31

### Changed

- Require Python 3.12

## [1.0.17] - 2026-10-31

### Changed

- Apply the template files and packages the upgrade left out

## [1.0.14] - 2026-10-30

### Changed

- No code change since 1.0.13: this release commits the bubblewrap sandbox verification of the terminal-CPR repair - vim drawn at 24x80 and repainted after a resize, a restored background terminal repainted at the fitted width, and the five response forms kept off the screen

## [1.0.13] - 2026-10-30

### Changed

- No code change since 1.0.12: this release publishes the same terminal-CPR repair with the changelog, README row and journal committed

## [1.0.12] - 2026-10-30

### Changed

- The terminal-CPR patch no longer clears the screen before replaying a session buffer or reconnects the xterm at a terminal's first show; it holds the size until the xterm opens, then steps the PTY one column narrower and back once so the running program repaints at the fitted size
- The response filter also removes the DSR answer, the XTWINOPS size reports, DECRQSS replies, kitty keyboard reports and the private CPR form, and a replay strips every query when one shell alone sits at the prompt

### Fixed

- Terminals running Claude Code and other full-screen programs no longer show a scrambled TUI, raw escape text, a blank or half screen at first show, or the wrong width

## [1.0.11] - 2026-10-30

### Changed

- Both lockfiles resolve every `@jupyterlab` package to one version, 4.6.5 on the 4.x line and apputils 4.7.5; `package.json`, its ranges and its resolutions are unchanged, so an install from either lockfile gets the same tree

### Fixed

- ESLint reports zero findings: twelve real warnings fixed (unused catch bindings, a leaked markdown TOC renderer, `describedBy` missing on two commands, three untranslated command strings) and the plugin-id rule scoped off for the patch plugins, which keep the old package names as their ids by design

## [1.0.10] - 2026-10-30

### Changed

- The README opens on the ten core patches and the problems they solve; the Features table names each patch's symptom and the mechanism that fixes it, taken from each patch's page
- The consolidation diagram moves out of the opening into a `## Why one extension` section after the Features table, with no edge labels because Mermaid draws them on a fixed pale box that fails in JupyterLab Dark

## [1.0.9] - 2026-10-30

### Changed

- The labextension and npm package take the scoped name `@stellarshenson/jupyterlab-core-patches-extension`, so the settings id is `@stellarshenson/jupyterlab-core-patches-extension:plugin`; the Python distribution, the import package and the ten patch plugin ids keep their names
- The wheel and the pip install command are unchanged, `jupyterlab_core_patches_extension`; npm consumers install the scoped package, because the labextension directory must equal the bundle package.json name

### Fixed

- Settings load on JupyterLab 4.6.5, whose client setting registry rejects a settings id whose scheme part holds an underscore; before the rename every patch switch fell back to its default and startup logged a settings failure

## [0.9.7] - 2026-10-29

First published release.

### Added

- One JupyterLab 4 labextension carrying ten core patches, each behind one boolean settings switch, default on; a false switch returns before any patch runs
- One settings schema, with the old package names kept as the ten plugin ids, so the package replaces `stellars_jupyterlab_fixes` and the ten discrete packages directly
- A Python server package with the shared settings reader, the extension routes and the three server-side patches: jump to definition, restore terminals and the terminal CPR escape

### Fixed

- Jump to definition no longer lets `String.replace` expand dollar patterns in a notebook cell before the source reaches Jedi
- Markdown viewer anchors resolve a percent-encoded fragment to a heading with a non-ASCII character, and a heading whose id holds a literal percent escape still matches its literal fragment

<!-- <END NEW CHANGELOG ENTRY> -->
