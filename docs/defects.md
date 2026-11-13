# Defects

Known defects of the core-patches extension, found in use or by reading `src/` and the Python package.

## Authors

- `@kj` Konrad Jelen

## Patches `PATCH`

Wrong behaviour of one of the eleven patches in ordinary use

- log: 2026-11-13T06:59:19Z @kj category created

- [x] `DEF-PATCH-1-JUMP-HISTORY` **Jump to definition raises the notebook execution count** - MEDIUM; each jump runs the Jedi code and a getcwd in the kernel with store_history on: the next cell number skips by 1 or 2 and the Jedi code lands in In[] and %history; fix: store_history false on both requestExecute calls; `src/fixes/jump-to-definition.ts`
  - evidence: store_history false on both requestExecute calls in src/fixes/jump-to-definition.ts; Jest 121, pytest 190, Galata 22 green on 2026-11-13
  - root-cause: 2026-11-13T07:08:49Z @kj requestExecute left store_history at its default true for the Jedi code and the getcwd call
  - repro: Python notebook, run a cell (In [1]), Ctrl+B on a symbol, run the cell again: it shows In [3] or In [4], not In [2]
  - test-tags: MANUAL
  - log: 2026-11-13T06:59:19Z @kj added
  - log: 2026-11-13T07:08:49Z @kj closed
- [-] `DEF-PATCH-2-TERM-POLL` **Terminal folders are reported every 15 s** - MINOR; each open page posts the terminal names every 15 s, also with no terminal open; the server reads every saved workspace file and walks /proc per terminal; `src/fixes/restore-terminals.ts`
  - repro: Open JupyterLab, watch the network tab: one POST jupyterlab-restore-terminals-fix/state every 15 s
  - test-tags: MANUAL
  - log: 2026-11-13T06:59:19Z @kj added
  - log: 2026-11-13T07:00:01Z @kj rejected: rejected: no event reports a cd, so the poll is the design; one small POST per 15 s, the /proc walk runs off the event loop
- [x] `DEF-PATCH-3-MD-IMAGE` **Markdown scroll guard holds 3 s on a failed image** - MEDIUM; Markdown view with an image that already failed holds its scroll 3 s after every tab switch: PageDown or a scrollbar drag in that time jumps back; cause: a complete image with naturalHeight 0 never counts as settled; fix: every complete image is settled and gets no listener; `src/fixes/markdown-switch-tab-scrolling.ts`
  - evidence: jest 'treats an image that failed before the activation as settled' passes; Jest 121, pytest 190, Galata 22 green on 2026-11-13
  - root-cause: 2026-11-13T07:08:49Z @kj settled test was img.complete with naturalHeight above 0; a failed image is complete with naturalHeight 0 and fires no further event
  - repro: Markdown preview with one broken image link, scroll down, switch tab away and back, press PageDown within 3 s: the view jumps back
  - test-tags: UNIT
  - log: 2026-11-13T06:59:27Z @kj added
  - log: 2026-11-13T07:08:49Z @kj closed
- [-] `DEF-PATCH-4-FILTER-COST` **Terminal output filter runs 18 regex passes per chunk** - MINOR; filter_terminal_responses runs 18 patterns over every pty chunk on the event loop: 4.1 ms per 64 KB measured; `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py`
  - repro: cat a 100 MB text file in a terminal and time it with the patch switch on and off
  - test-tags: MANUAL
  - log: 2026-11-13T06:59:27Z @kj added
  - log: 2026-11-13T07:00:01Z @kj rejected: rejected: 4.1 ms per 64 KB is not seen in ordinary terminal use; one combined pattern would change the ported filter
- [x] `DEF-PATCH-5-SWITCHDIR` **Server halves read the switches from a folder JupyterLab does not write** - MAJOR; A user who turns off the restore-terminals switch, the terminal CPR escape switch or its redraw option still gets the server half of that patch, because the server reads the switch file under the Jupyter data folder while JupyterLab writes it under the config folder.
  - evidence: pytest jupyterlab_core_patches_extension/tests/test_settings.py::test_server_app_reads_the_folder_jupyterlab_writes passes: a real ServerApp reads the switch as false from the folder JupyterLab writes
  - repro: Set jupyterlab_restore_terminals_fix to false in Settings, restart the server: the saved terminals are still re-created
  - test-tags: UNIT
  - root-cause: 2026-11-13T07:38:14Z @kj settings.py _settings_path fell back to jupyter_data_dir()/lab/user-settings because ServerApp has no user_settings_dir attribute; JupyterLab stores user settings in LabApp.user_settings_dir (~/.jupyter/lab/user-settings)
  - log: 2026-11-13T07:38:14Z @kj added
  - log: 2026-11-13T07:38:34Z @kj closed
