# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
