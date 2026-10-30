# Acceptance Criteria

Behaviour the core-patches extension must show. One labextension entry carries ten plugins; every patch has one settings switch, default `true`; a switch set to `false` leaves the stock JupyterLab behaviour in place.

## Authors

- `@kj` Konrad Jelen

## Extension shape `CORE`

One labextension entry, one settings schema and the plugin ids that carry the ten patches.

- log: 2026-10-29T07:56:35Z @kj category created

- [x] `ACC-CORE-1-ENTRY` **One entry, ten patches** - HIGH; One labextension entry; schema/plugin.json holds ten booleans, all default true; each patch plugin keeps its old package name as its id.
  - evidence: Galata activation.spec 20/20; pytest test_extension.py 3 passed; schema 10 booleans, built labextension identical (verify2.json)
  - test: ui-tests/tests/activation.spec.ts checks the entry; jupyterlab_core_patches_extension/tests/test_extension.py checks ten schema booleans
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:35Z @kj added
  - log: 2026-10-29T09:40:12Z @kj closed
- [x] `ACC-CORE-2-ACTIVATE` **Activation message** - MEDIUM; The main plugin logs JupyterLab extension @stellarshenson/jupyterlab-core-patches-extension is activated! exactly once on page load.
  - evidence: Galata activation.spec asserts exactly 1 activation message; 20 passed (galata.json)
  - test: ui-tests/tests/activation.spec.ts filters console messages and asserts length 1
  - test-tags: FUNCTIONAL
  - log: 2026-10-29T07:56:35Z @kj added
  - log: 2026-10-29T09:40:12Z @kj closed
  - log: 2026-10-29T15:05:57Z @kj edited text "The main plugin logs JupyterLab extension jupyterlab_core_patches_extension is activated! exactly once on page load." -> "The main plugin logs JupyterLab extension jupyterlab-core-patches-extension is activated! exactly once on page load."; reason: The labextension rename moves the activation message to the hyphenated name so the settings id stays URI-safe on JupyterLab 4.6.5
  - log: 2026-10-30T08:13:26Z @kj edited text "The main plugin logs JupyterLab extension jupyterlab-core-patches-extension is activated! exactly once on page load." -> "The main plugin logs JupyterLab extension @stellarshenson/jupyterlab-core-patches-extension is activated! exactly once on page load."; reason: The npm package and labextension move to the scoped name @stellarshenson/jupyterlab-core-patches-extension, because npm rejects the unscoped name as too similar to the published Python distribution; the activation message carries the scoped name
- [x] `ACC-CORE-3-GUARD` **Second patch skipped** - CRITICAL; A patch already applied by an installed old package is detected by its marker; the new plugin returns without patching a second time.
  - evidence: Jest 101/101; each guarded patch spec calls the patch twice and asserts a no-op (junit.xml)
  - test: src/**tests**/file-browser-column-width.spec.ts and the other guarded patches' Jest files call the patch twice and assert the second call is a no-op
  - test-tags: UNIT, FUNCTIONAL
  - log: 2026-10-29T07:56:35Z @kj added
  - log: 2026-10-29T09:40:12Z @kj closed
- [x] `ACC-CORE-4-PACKAGE` **Wheel installs and extension points** - HIGH; The wheel installs; jupyter labextension list reports the extension OK; pytest asserts _jupyter_labextension_paths and _jupyter_server_extension_points return the package entries.
  - evidence: make install 0.1.4; labextension and server extension enabled OK; test_extension.py 3 passed
  - test: jupyterlab_core_patches_extension/tests/test_extension.py and make install
  - test-tags: UNIT, INTEGRATION
  - log: 2026-10-29T07:56:35Z @kj added
  - log: 2026-10-29T09:40:12Z @kj closed
- [x] `ACC-CORE-5-DOCS` **README tally and per-fix pages** - MEDIUM; README lists all ten patches and links one docs/<slug>.md page per patch; each page states the switch, plugin id, patched member, guard, source and tests.
  - evidence: pytest test_docs.py 2 passed; README links all ten pages
  - test: jupyterlab_core_patches_extension/tests/test_docs.py
  - test-tags: UNIT
  - log: 2026-10-29T07:56:35Z @kj added
  - log: 2026-10-29T09:40:12Z @kj closed

## Patch toggles `PATCH`

One settings switch per patch; false returns before patching; all default true.

- log: 2026-10-29T07:56:36Z @kj category created

- [x] `ACC-PATCH-6-FONT` **UI font size switch** - HIGH; jupyterlab_change_ui_font_size_fix defaults true; true scopes the icon scaling CSS to body.jp-core-patches-change-ui-font-size, false leaves stock alignment; reload applies the value.
  - evidence: Galata change-ui-font-size.spec passed; Jest 101/101; pytest 198 passed
  - test: ui-tests/tests/change-ui-font-size.spec.ts toggles the switch and asserts the scoped class and icon size
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:12Z @kj closed
  - log: 2026-10-29T09:40:16Z @kj edited text "jupyterlab_change_ui_font_size_fix defaults true; true scopes the icon scaling CSS to body.jp-core-patches-font-size, false leaves stock alignment; reload applies the value." -> "jupyterlab_change_ui_font_size_fix defaults true; true scopes the icon scaling CSS to body.jp-core-patches-change-ui-font-size, false leaves stock alignment; reload applies the value."
- [x] `ACC-PATCH-7-COLS` **File browser column width switch** - HIGH; jupyterlab_file_browser_column_width_fix defaults true; true patches DirListing width recovery, false leaves stale cached widths; reload applies the value.
  - evidence: Galata file-browser-column-width.spec passed off/on; Jest 101/101
  - test: ui-tests/tests/file-browser-column-width.spec.ts toggles the switch and asserts the stale-width recovery stops
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:12Z @kj closed
- [x] `ACC-PATCH-8-JUMP` **Jump to definition switch** - HIGH; jupyterlab_jump_to_definition_fix defaults true; true overrides the LSP jump command, false leaves the stock command; reload applies the value.
  - evidence: Galata jump-to-definition.spec passed; Jest 101/101
  - test: ui-tests/tests/jump-to-definition.spec.ts toggles the switch and asserts the stock command runs
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:13Z @kj closed
- [x] `ACC-PATCH-9-SCROLL` **Markdown tab scrolling switch** - HIGH; jupyterlab_markdown_switch_tab_scrolling_fix defaults true; true restores scroll position after image load, false leaves the jump; reload applies the value.
  - evidence: Galata markdown-switch-tab-scrolling.spec passed; Jest 101/101
  - test: ui-tests/tests/markdown-switch-tab-scrolling.spec.ts toggles the switch and asserts the scroll jump returns
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:13Z @kj closed
- [x] `ACC-PATCH-10-SYNTAX` **Markdown syntax rendering switch** - HIGH; jupyterlab_markdown_syntax_rendering_fix defaults true; true highlights rendered fenced blocks, false leaves plain text; reload applies the value.
  - evidence: Galata markdown-syntax-rendering.spec passed; Jest 101/101
  - test: ui-tests/tests/markdown-syntax-rendering.spec.ts toggles the switch and asserts plain text returns
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:13Z @kj closed
- [x] `ACC-PATCH-11-TOC` **Markdown viewer TOC switch** - HIGH; jupyterlab_markdown_viewer_toc_fix defaults true; true fixes TOC anchors, false leaves broken anchors; reload applies the value.
  - evidence: Galata markdown-viewer-toc.spec passed; Jest 101/101
  - test: ui-tests/tests/markdown-viewer-toc.spec.ts toggles the switch and asserts the broken anchor returns
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:13Z @kj closed
- [x] `ACC-PATCH-12-MENU` **Other file type menu switch** - HIGH; jupyterlab_other_file_type_menu_fix defaults true; true adds the context menu for unregistered types, false leaves the stock menu; reload applies the value.
  - evidence: Galata other-file-type-menu.spec passed; Jest 101/101
  - test: ui-tests/tests/other-file-type-menu.spec.ts toggles the switch and asserts the menu item disappears
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:13Z @kj closed
- [x] `ACC-PATCH-13-RESTORE` **Restore terminals switch** - HIGH; jupyterlab_restore_terminals_fix defaults true; true restores terminal working directories after a workspace restore, false leaves the stock behaviour; reload applies the value.
  - evidence: Galata restore-terminals.spec passed; pytest restore suites 26 passed incl. real restart
  - test: ui-tests/tests/restore-terminals.spec.ts toggles the switch and asserts the stock cwd returns
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:13Z @kj closed
- [x] `ACC-PATCH-14-PROXY` **Server proxy launcher switch** - HIGH; jupyterlab_server_proxy_launcher_fix defaults true; true fixes SVG icons of server-proxy launchers, false leaves the stock icons; reload applies the value.
  - evidence: Galata server-proxy-launcher.spec passed; Jest 101/101
  - test: ui-tests/tests/server-proxy-launcher.spec.ts toggles the switch and asserts the stock icon returns
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:13Z @kj closed
- [x] `ACC-PATCH-15-CPR` **Terminal CPR escape switch** - HIGH; jupyterlab_terminal_cpr_escape_fix defaults true; true filters CPR escape text in idle terminals, false leaves the escape text; redrawBackgroundTerminals keeps its default true; reload applies both.
  - evidence: Galata terminal-cpr-escape.spec passed; pytest test_terminal_cpr_escape.py 163 passed
  - test: ui-tests/tests/terminal-cpr-escape.spec.ts toggles the switch and asserts the escape text returns
  - test-tags: FUNCTIONAL, UNIT
  - log: 2026-10-29T07:56:36Z @kj added
  - log: 2026-10-29T09:40:13Z @kj closed
