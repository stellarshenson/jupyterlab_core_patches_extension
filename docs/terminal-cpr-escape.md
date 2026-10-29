# Terminal CPR escape

Filters terminal query responses that fish and other shells print as literal text in an idle terminal, and redraws a terminal restored in a background tab at its real size when its tab is first shown. This extension is a direct replacement for the discrete `jupyterlab_terminal_cpr_escape_fix` package and for that package's entry in the `stellars_jupyterlab_fixes` bundle. Uninstall the bundle and the discrete package before installing this one, because two installed copies apply every patch twice.

The filter runs on the server, in `jupyter_server_terminals`. It removes CPR, DA, DA2, DECRPM and OSC colour responses from live output and from a buffer replay, in both the ESC-prefixed form and the bare form that fish produces after it strips ESC. The same server patch strips terminal queries from a replay, clears the client's terminal before the replay, and steps the PTY size after an attach so a full-screen program repaints. The frontend part handles a terminal restored in a background tab: it holds back the size that the unopened 80x24 xterm reports and reconnects the session once when the tab is first shown, so the server replays the history into the fitted xterm.

- **Switch** - `jupyterlab_terminal_cpr_escape_fix`, boolean, default `true`. The frontend plugin reads the switch at activation, so a change applies on the next page reload. The server wrappers read the same switch on every terminal output and on every socket open, so the server half stops patching at the next call after a change
- **Plugin id** - `jupyterlab_terminal_cpr_escape_fix:plugin`
- **Patched member** - server: `jupyter_server_terminals.handlers.TermSocket.on_pty_read` and `TermSocket.open`; frontend: the `send` method and the `messageReceived` signal of each terminal session, the terminal's `disposed` signal and a `MutationObserver` on the terminal node
- **Guard** - server: the class attribute `TermSocket._jp_terminal_cpr_escape_patched`, set by `patch_term_socket` before the wrappers are installed, makes a second call a no-op. Frontend: the module-level `WeakSet` `heldTerminals` makes a second `holdUntilOpened` call on the same terminal a no-op. The source frontend had no guard; without one a second call wraps `session.send` again and leaves a stale wrapper on the session after the first open restores the original, and refreshes twice
- **Source** - `jupyterlab_terminal_cpr_escape_fix` v1.0.22: `src/index.ts`, `src/unopenedTerminal.ts`, `jupyterlab_terminal_cpr_escape_fix/__init__.py`, `handlers.py` and `replay_clear.py`. The patch logic is ported unchanged; the switch gate, the settings source and the import paths are the only changes
- **Jest test** - `src/__tests__/terminal-cpr-escape.spec.ts`. Ports the source's `unopenedTerminal.spec.ts` tests and adds the plugin gate, the `redrawBackgroundTerminals` option, the second-call no-op and the double activation no-op
- **Galata test** - `ui-tests/tests/terminal-cpr-escape.spec.ts`. With the switch off, showing a terminal restored in a background tab opens one websocket. With the switch on it opens two, because the first show reconnects the session. With `redrawBackgroundTerminals` off it opens one again

## Behaviour

- **Response filter** - applies to live output and to a replay; matches only responses, never queries, so capability negotiation keeps working
- **Replay queries** - removed from a replay except a run of queries that ends it, because the program that sent that run may still wait for the answer
- **Clear before replay** - prefixes `ESC[H ESC[2J ESC[3J`; leaves the alternate screen first when the first alternate-screen switch in the replay enters it, and enters it again when the first switch leaves it. No full or soft reset, so input modes survive. An empty buffer is cleared too
- **Repaint on attach** - sets the PTY one column narrower 0.4 s after an attach and back 0.12 s later; at most one step per terminal per 5 s; skipped while the foreground process group is one shell alone
- **Background terminal** - an unopened xterm reports 80x24 and writes the replay into it; the patch drops `set_size` until the xterm opens, then reconnects once if output arrived while the tab was hidden
- **Apply time** - a switch change reaches the frontend on the next page reload and the server on the next terminal output or socket open

## Server part

The module exports `patch_term_socket(server_app)` and registers no HTTP route. The integrator calls it from `_load_jupyter_server_extension`. `redrawBackgroundTerminals` gates the repaint step and is read on every attach; the other four source defaults (`suppress_buffer_replay` off, `filter_osc_color_responses` on, `strip_replay_queries` on, `clear_before_replay` on) are fixed module constants because this package exposes no switch for them.

## Limits

- **Galata scope** - the test counts websocket opens, the extension's own redraw. It does not assert the width of the replayed history, which depends on the xterm buffer size and the shell prompt, and it does not exercise the response filter, which needs a shell that strips ESC from a CPR response (fish)
- **Repaint step** - a client resize to exactly `cols - 1` within the step window is taken for the step and reverted; the PTY is one column wider than that client until the next resize
- **Line editors** - a line editor that is not one of the eight shells in `_SHELLS` is still stepped; on a system without `/proc/<pid>/task/<pid>/children` the step always runs
- **Unopened xterm** - the hold and the redraw apply only to a terminal whose xterm was never opened; a terminal already shown keeps the stock flow

## Members

| Member                                                       | File                                                              | Purpose                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `default` (`plugin`)                                         | `src/fixes/terminal-cpr-escape.ts`                                | Gates on the switch, reads the redraw option and connects `holdUntilOpened` to `widgetAdded` |
| `SWITCH_KEY`                                                 | `src/fixes/terminal-cpr-escape.ts`                                | The settings key the plugin gates on                                                         |
| `REDRAW_OPTION`                                              | `src/fixes/terminal-cpr-escape.ts`                                | The settings key that gates the redraw                                                       |
| `isEnabled`                                                  | `src/fixes/terminal-cpr-escape.ts`                                | Reads `redrawBackgroundTerminals` at each decision; true until the settings load             |
| `holdUntilOpened`                                            | `src/fixes/terminal-cpr-escape/unopenedTerminal.ts`               | Holds back `set_size` before the open and refreshes once at the first open                   |
| `heldTerminals`                                              | `src/fixes/terminal-cpr-escape/unopenedTerminal.ts`               | WeakSet that makes a second call for the same terminal a no-op                               |
| `isOpened`                                                   | `src/fixes/terminal-cpr-escape/unopenedTerminal.ts`               | True once xterm.js has appended the `.xterm` element                                         |
| `onMessage`                                                  | `src/fixes/terminal-cpr-escape/unopenedTerminal.ts`               | Records stdout that arrived while the terminal was hidden                                    |
| `release`                                                    | `src/fixes/terminal-cpr-escape/unopenedTerminal.ts`               | Restores the original `send` and disconnects the listeners and observer                      |
| `patch_term_socket`                                          | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Installs the two `TermSocket` wrappers once                                                  |
| `filter_terminal_responses`                                  | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Removes every matching response and returns the counts and the matches                       |
| `strip_replay_queries`                                       | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Removes queries from a replay except a run that ends it                                      |
| `clear_before_replay`                                        | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Prefixes the clear, with an alternate-screen switch when needed                              |
| `_first_alternate_screen_switch`                             | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Returns `h` or `l` for the first alternate-screen switch                                     |
| `_shell_at_prompt`                                           | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | True when the PTY foreground group is one shell alone                                        |
| `_make_winsize_bounce`                                       | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Builds the one-column-narrower step and its guarded restore                                  |
| `_filtered_on_pty_read`                                      | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Wrapper that gates the switch and filters the output                                         |
| `_patched_open`                                              | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Wrapper that gates the switch, applies the replay steps and schedules the repaint            |
| `_replay_steps`                                              | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Applies query stripping and the clear to a replay                                            |
| `_flush_log`                                                 | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Writes the accumulated filter counts once a minute                                           |
| `DEFAULTS`                                                   | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | The four internal source defaults that stay fixed                                            |
| `SWITCH_KEY`, `REDRAW_OPTION`, `_PATCH_MARKER`               | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | The switch key, the redraw key and the class marker                                          |
| `FILTER_PATTERNS`                                            | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | The named patterns in removal order; bare OSC is dropped when its toggle is off              |
| `REPLAY_QUERY`                                               | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | The terminal queries removed from a replay                                                   |
| `ESC_CPR`, `ESC_DA`, `ESC_DA2`, `ESC_DECRPM`, `ESC_OSC`      | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | ESC-prefixed response patterns                                                               |
| `BARE_CPR`, `BARE_DA`, `BARE_DA2`, `BARE_DECRPM`, `BARE_OSC` | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Bare response patterns left after a shell strips ESC                                         |
| `_PRIVATE_MODE`, `_ALTERNATE_SCREEN_MODES`                   | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Alternate-screen switch matcher and modes 47, 1047, 1049                                     |
| `_CLEAR`, `_LEAVE_ALTERNATE`, `_ENTER_ALTERNATE`             | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | The clear prefix and the alternate-screen leave and enter sequences                          |
| `_SHELLS`                                                    | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | The shell names treated as a shell at its prompt                                             |
| `_BOUNCE_DELAY`, `_BOUNCE_STEP`, `_BOUNCE_DEBOUNCE`          | `jupyterlab_core_patches_extension/server/terminal_cpr_escape.py` | Repaint delay, restore pause and per-terminal debounce                                       |
