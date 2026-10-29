# Markdown switch-tab scrolling

Keeps the scroll position of a Markdown view while its images load after a tab switch. This extension is a direct replacement for the discrete `jupyterlab_markdown_switch_tab_scrolling_fix` package; uninstall that package before enabling this one, because two installed copies would apply the patch twice.

The patch connects to `ILabShell.currentChanged`. When the new widget holds a `.jp-RenderedMarkdown` node with at least one image, it records the scroll position and restores it every 100 ms until one of three events: every image has loaded or failed and the position has been stable for three polls, the user scrolls with the wheel or a touch, or 3 seconds pass. While the guard runs, it sets `data-jp-scroll-guard="active"` on the widget node.

- **Switch**: `jupyterlab_markdown_switch_tab_scrolling_fix`, boolean, default `true`; a change applies on the next page reload
- **Plugin id**: `jupyterlab_markdown_switch_tab_scrolling_fix:plugin`
- **Patched member**: the `ILabShell.currentChanged` connection; no prototype member is wrapped
- **Guard**: the window key `__jp_markdown_switch_tab_scrolling_fix__` records an active patch, so a second activation returns before it connects another handler. The source package had no guard; a second connection would run a second interval and remove the shared `data-jp-scroll-guard` attribute while the first guard is still live
- **Source**: `/home/lab/workspace/private/jupyterlab/jupyterlab_markdown_switch_tab_scrolling_fix`
- **Jest test**: `src/__tests__/markdown-switch-tab-scrolling.spec.ts`
- **Galata test**: `ui-tests/tests/markdown-switch-tab-scrolling.spec.ts`

The Galata test asserts the marker, not a visible scroll jump: image decode timing is not reproducible, so the test leaves the image request pending and checks that the marker appears only when the switch is on and clears on the guard timeout.

## Members

| Member                   | Kind     | Purpose                                                              |
| ------------------------ | -------- | -------------------------------------------------------------------- |
| `default`                | plugin   | Registers the patch under the source plugin id                       |
| `GUARD_ATTRIBUTE`        | constant | `data-jp-scroll-guard`, set on the widget node while a guard is live |
| `PATCH_MARKER`           | constant | Window key that makes a second activation a no-op                    |
| `SWITCH_KEY`             | constant | The settings schema key the gate reads                               |
| `GUARD_INTERVAL_MS`      | constant | Guard poll interval, 100 ms                                          |
| `MAX_GUARD_ATTEMPTS`     | constant | Poll count that ends the guard, 30                                   |
| `STABILITY_THRESHOLD`    | constant | Stable polls needed after every image settles, 3                     |
| `releaseGuard`           | helper   | Clears the interval, forgets the widget and removes the attribute    |
| `handleWidgetActivation` | helper   | Captures the scroll position and starts a guard on a Markdown widget |
| `imageLoadHandler`       | helper   | Counts one image as settled on load or error                         |
| `userScrollHandler`      | helper   | Marks a wheel or touch scroll so the guard stops                     |
| `stopGuard`              | helper   | Releases the guard and removes its scroll listeners                  |
