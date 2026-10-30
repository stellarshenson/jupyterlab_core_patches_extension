# Changelog

<!-- <START NEW CHANGELOG ENTRY> -->

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
