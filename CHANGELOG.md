# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
