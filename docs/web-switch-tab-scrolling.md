# Web switch-tab scrolling

Keeps the scroll position of an iframe tab across a tab switch, a frame refresh and a full page reload. Headed Chrome drops the scroll offset of an iframe document when its tab is hidden with `display: none` and shows the document at the top when the tab returns. The document is not reloaded and no page code moves the scroll, so the position is recorded before the hide and put back after the show.

- **Switch**: `jupyterlab_web_switch_tab_scrolling_fix`, boolean, default `true`; a change applies on the next page reload
- **Plugin id**: `@stellarshenson/jupyterlab-core-patches-extension:web-switch-tab-scrolling`
- **Patched member**: the `ILabShell.currentChanged` connection and the activated widget's own `hide` method, wrapped once per widget; no prototype member is wrapped
- **Guard**: the window key `__jp_web_switch_tab_scrolling_fix__` records an active patch, so a second activation returns before it connects another handler
- **Source**: `src/fixes/web-switch-tab-scrolling.ts`
- **Jest test**: `src/__tests__/web-switch-tab-scrolling.spec.ts`
- **Galata test**: `ui-tests/tests/web-switch-tab-scrolling.spec.ts`

## Behaviour

- **Record** - a scroll listener on each same-origin frame's `contentWindow` stores `scrollX` and `scrollY` while the frame has a layout box and no ancestor carries `lm-mod-hidden`. Chrome writes `scrollY = 0` as the frame is hidden; that zero never overwrites the last visible position. A scroll event the patch raises itself, when its own `scrollTo` is clamped by a short document, is dropped: it never replaces the saved offset or the guard's target. The activated widget's own `hide` is wrapped once per widget, so every visible frame is recorded just before the hide applies: Chrome queues a frame scroll event to the next rendering step, and that event arrives after the frame is hidden with its offset reset, too late to store the position. The hide snapshot skips the offset the patch itself last applied to the document, so a restore that a short document clamped is not stored as the user position
- **Restore on activation** - `ILabShell.currentChanged` finds every `.jp-IFrame iframe` in the new widget, attaches the scroll recorder to the frame document once and restores its stored position. A guard polls every 100 ms for at most 3 s and stops on a wheel or touch scroll in the frame, when the position has been stable for three polls, or at the cap
- **Restore on frame refresh** - a load listener on the iframe element instruments the new document and, while the widget is visible, runs the activation handler for that widget, so the 100 ms guard retries the stored position while a proxy page paints its content; a hidden frame keeps the position for the next activation. The recorder is keyed by `Document`, not by `Window`, because `contentWindow` returns the same WindowProxy after a navigation while the listeners added to the previous inner window are gone
- **Restore on page reload** - the last position per URL is written to sessionStorage on scroll, throttled by 250 ms, and read on activation after a full JupyterLab reload
- **Cross-origin** - every read of `contentWindow.location` or `contentWindow.document` is wrapped; a throw skips the frame silently
- **Storage key** - positions are keyed by the frame document URL

## Limits

- The reset reproduces in headed Chrome only. Headless Chrome preserves the offset across `display: none`, so a headless Galata run cannot fail; the Galata spec sets `headless: false`, and the run needs a display, such as `xvfb-run`
- A cross-origin frame cannot be read, so its position is neither recorded nor restored
- The position lives in the window that runs JupyterLab; a second browser tab does not carry it
- The guard holds the position for at most 3 s. A document that keeps moving its own scroll after that is not corrected

## Members

| Member                   | Kind     | Purpose                                                                                   |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `default`                | plugin   | Registers the patch under its plugin id                                                   |
| `PATCH_MARKER`           | constant | Window key that makes a second activation a no-op                                         |
| `SWITCH_KEY`             | constant | The settings schema key the gate reads                                                    |
| `STORAGE_PREFIX`         | constant | Prefix of one sessionStorage entry; the frame URL follows it                              |
| `GUARD_INTERVAL_MS`      | constant | Guard poll interval, 100 ms                                                               |
| `MAX_GUARD_ATTEMPTS`     | constant | Poll count that ends the guard, 30                                                        |
| `STABILITY_THRESHOLD`    | constant | Stable polls that release the guard, 3                                                    |
| `STORAGE_WRITE_MS`       | constant | Delay that batches sessionStorage writes, 250 ms                                          |
| `isVisible`              | helper   | True when the frame has a layout box and no hidden ancestor                               |
| `frameUrl`               | helper   | Same-origin frame URL, or `null` when the read throws                                     |
| `readStored`             | helper   | One persisted position from sessionStorage                                                |
| `writeStored`            | helper   | Throttled write of the current position to sessionStorage                                 |
| `record`                 | helper   | Stores the scroll offset of one visible frame                                             |
| `restore`                | helper   | Moves a frame to its stored position, from memory or sessionStorage                       |
| `instrument`             | helper   | Attaches the scroll recorder once per frame document and the load listener once per frame |
| `releaseGuard`           | helper   | Clears the interval and removes the guard's user-scroll listeners                         |
| `handleWidgetActivation` | helper   | Restores every frame of an activated widget and starts the guard                          |

## Running the Galata test

- **Headed only** - headless Chrome keeps the iframe scroll across `display: none`, so a headless run cannot fail and proves nothing. From `ui-tests`, run `xvfb-run -a jlpm playwright test tests/web-switch-tab-scrolling.spec.ts --headed`
- **GalaxaLab image** - the Galata page fixture waits for the Launcher tab to be current, and the GalaxaHub MOTD tab opens instead, so the run goes through the standard bubblewrap runner (`scripts/galata-bwrap.sh` in the `jupyterlab-extension` skill), which seeds `c.GalaxaHubMotd.open_on_start = False`, or through a scratch config that turns that switch off. The spec and its assertions are unaffected
- **CI** - runs the suite headed under Xvfb, as `.github/workflows/build.yml` sets it
