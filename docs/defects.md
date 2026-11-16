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
- [x] `DEF-PATCH-7-TERMINAL-INPUT` **Terminal 1 takes no typed input** - MAJOR; live lab Terminal 1 (pts/2, Claude Code in private/jupyterlab) shows no typed text; the program runs and its pty has 0 queued input bytes; cause unknown, the four terminal patches do not touch stdin; reproduce first
  - test-tags: UNIT, FUNCTIONAL
  - evidence: terminal CPR escape patch reconnects a tab JupyterLab gave up on, on page shown, online and typing; ACC-PATCH-44-RECONNECT-VISIBLE to ACC-PATCH-49-RECONNECT-DOCS closed; wf_c28fcb05-5a9 Jest 129, Galata 25/25 on 1.0.33; review wf_8bc58fd2-c0f SHIP
  - related: ACC-PATCH-44-RECONNECT-VISIBLE, ACC-PATCH-45-RECONNECT-ONLINE, ACC-PATCH-46-RECONNECT-TYPING, ACC-PATCH-47-RECONNECT-ONCE, ACC-PATCH-48-RECONNECT-SWITCH, ACC-PATCH-49-RECONNECT-DOCS
  - root-cause: 2026-11-16T09:57:34Z @kj likely cause: stock @jupyterlab/services 7.6.5 TerminalConnection stops after 7 failed reconnects (random delay 0 to 2^n-1 s), sets disconnected and never retries; send() queues stdin while not connected, so the tab keeps its last screen and typing appears to do nothing; evidence: no browser websocket for terminal 1 since 08:57 local, 0 browser requests 10:23-10:38, the 10:39 wake reconnected terminals 2 4 6 7 10 11 12 but not 1 or 5
  - repro: type into Terminal 1 of the live lab after the 2026-11-15 20:02 server start; nothing appears
  - log: 2026-11-16T09:50:27Z @kj added
  - log: 2026-11-16T09:57:34Z @kj root-cause recorded; reason: the cause needs the reconnect limit, the queue behaviour and the log evidence in one line
  - log: 2026-11-16T09:57:34Z @kj not a regression of DEF-free terminal delivery guard (1.0.24, ACC-PATCH-29 to 32): that guard keeps output flowing to attached clients; here no client is attached; guard present in the installed server file
  - log: 2026-11-16T09:57:40Z @kj correction of the previous line: read 'not a regression of the terminal delivery guard'; 'DEF-free' was a typing error
  - log: 2026-11-16T09:59:09Z @kj owner confirmed terminal 5 stuck too; terminal 5 was predicted from the log (no browser attach since 07:30 local, missing from the 10:39 reconnect), which supports the root cause
  - log: 2026-11-16T10:32:50Z @kj closed
  - log: 2026-11-16T10:32:58Z @kj edited test-tags added "UNIT, FUNCTIONAL"; evidence "terminal CPR escape patch reconnects a tab JupyterLab gave up on, on page shown, online and typing; ACC-PATCH-44 to 49 closed; wf_c28fcb05-5a9 Jest 129, Galata 25/25 on 1.0.33; review wf_8bc58fd2-c0f SHIP" -> "terminal CPR escape patch reconnects a tab JupyterLab gave up on, on page shown, online and typing; ACC-PATCH-44-RECONNECT-VISIBLE to ACC-PATCH-49-RECONNECT-DOCS closed; wf_c28fcb05-5a9 Jest 129, Galata 25/25 on 1.0.33; review wf_8bc58fd2-c0f SHIP"
- [x] `DEF-PATCH-8-TRASH-SPEC` **File delete Galata spec fails beside the advanced file browser 1.0.6** - MEDIUM; ui-tests/tests/file-delete-trash.spec.ts finds the confirm button as .jp-Dialog .jp-mod-warn and expects 'Move to Trash'; with jupyterlab_advanced_file_browser_extension 1.0.6 in /opt/conda the warn button is 'Delete Permanently', and its Move to Trash shows only on a mount it monitors, so the headed suite has 1 failure of 25
  - evidence: spec finds the confirm button by label 'Move to Trash', test config sets AdvancedFileBrowser.trash_on_all_volumes; verify wf_93caa560-119 6/6 (stock dialog still matches, config harmless without the extension); headed Galata 25/25 on 1.0.35; ponytail Ship
  - related: ACC-PATCH-40-BROWSER-DELETE
  - repro: make install, then the headed Galata suite through galata-bwrap.sh with jupyterlab_advanced_file_browser_extension 1.0.6 installed: file-delete-trash.spec.ts:84 received 'Delete Permanently'
  - test-tags: FUNCTIONAL
  - root-cause: 2026-11-16T11:41:56Z @kj the spec depends on the stock delete dialog layout; the advanced file browser 1.0.6, installed into /opt/conda at 2026-11-16 12:00:34 by another session, replaces that dialog in every lab that loads from /opt/conda, the Galata lab included
  - log: 2026-11-16T11:41:56Z @kj added; reason: the cause needs the selector, both extension behaviours and the failing count
  - log: 2026-11-16T11:57:01Z @kj closed

## Build and release `BUILD`

Build, lint and release tooling of the extension

- log: 2026-11-14T08:55:17Z @kj category created

- [x] `DEF-BUILD-6-PRETTIER` **Prettier rewrites test paths in the criteria tracker** - MINOR; jlpm prettier, the release lint step, reads the underscores in `src/__tests__/` as emphasis and writes `src/**tests**/` into docs/acc-crit.md: 6 lines, 4 test hints and 2 log lines; a reader looking for the named test finds no such folder
  - evidence: .prettierignore lists the three tracker files: sha256 unchanged across jlpm prettier, lint:check exit 0, six lines restored; fix wf_4770c325-050 ACCEPTED (Jest 121, pytest 206, Galata 23/23); review wf_98c09d0c-59a round 1 SHIP
  - repro: jlpm prettier with a criterion test hint naming src/__tests__/x.spec.ts; the hint then reads src/**tests**/x.spec.ts
  - test-tags: MANUAL
  - root-cause: 2026-11-14T08:55:17Z @kj prettier formats docs/*.md as markdown and rewrites a word wrapped in double underscores, strong emphasis, to double asterisks
  - log: 2026-11-14T08:55:17Z @kj added
  - log: 2026-11-14T09:10:03Z @kj closed

