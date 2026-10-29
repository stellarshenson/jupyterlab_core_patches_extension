# Markdown viewer table of contents

Restores table-of-contents navigation and in-document anchor links in the Markdown Viewer. This extension is a direct replacement for the discrete `jupyterlab_markdown_viewer_toc_fix` package and for the `stellars_jupyterlab_fixes` bundle that installs it. Uninstall both before enabling this one, because two installed copies apply the patch twice.

- **Switch** - `jupyterlab_markdown_viewer_toc_fix`, boolean, default `true`; a change applies on the next page reload
- **Plugin id** - `jupyterlab_markdown_viewer_toc_fix:plugin`
- **Patched member** - `RenderedHTMLCommon.prototype.setFragment` for the `text/html` renderer, each Markdown Viewer content's `setFragment`, and each viewer's TOC model `activeHeadingChanged` signal
- **Guard** - the window key `__jp_markdown_viewer_toc_fix__` records an active patch, so a second activation returns before it wraps the prototype or connects another tracker signal
- **Source** - `/home/lab/workspace/private/jupyterlab/jupyterlab_markdown_viewer_toc_fix`
- **Jest test** - `src/__tests__/markdown-viewer-toc.spec.ts`
- **Galata test** - `ui-tests/tests/markdown-viewer-toc.spec.ts`

JupyterLab 4.6 resolves an anchor whose case matches the heading, so the Galata test proves the patch through the case-insensitive fallback and the window marker.

## Mechanism

JupyterLab's HTML sanitizer removes `id` attributes when `allowNamedProperties` is false and leaves `data-jupyter-id` instead. Navigation code that queries `id` alone finds nothing. The patch resolves the fragment through the attribute the sanitizer keeps, and falls back for a fragment whose case differs from the heading.

- **Renderer patch** - wraps `RenderedHTMLCommon.prototype.setFragment`, queries `#id` then `[data-jupyter-id]`, scrolls the match into view and calls the stock method when no element matches
- **Viewer patch** - wraps each Markdown Viewer content's `setFragment`, scrolls to the match and calls the stock method only on a miss
- **Rendered signal** - after a render, re-applies `window.location.hash` unless the view already scrolled to that hash, so a re-render of the same document leaves the reader where they are
- **Hash change** - a `hashchange` listener on the window re-applies the hash for an in-document link click and is removed when the widget is disposed
- **TOC patch** - after 100 ms reads the viewer's TOC model, and on `activeHeadingChanged` resolves the heading id through `TableOfContentsUtils.Markdown.getHeadingId` and scrolls `h{level}[{attribute}]`
- **Router** - re-applies the current hash 300 ms after an `IRouter.routed` signal, and a global `hashchange` fallback re-applies it 100 ms after the event
- **Switch off** - `activate` returns before any patch is installed, so the renderer and the viewers keep the stock navigation

## Port notes

- **Server part** - none; the source package's `__init__.py` declares only the labextension path
- **CSS** - none; the source stylesheet holds only the scaffold comment, so the port adds no stylesheet and no body class
- **Double patch** - the source has no guard and the patch is not idempotent: a second activation wraps the prototype and connects the tracker signals again. The port adds the window marker before the first patch
- **Debug logger** - the source's `logDocumentHeaders` has a fully commented body and is not ported; its 50 ms timer ran no code
- **Settings source** - the source read its own plugin schema; this port reads `jupyterlab_core_patches_extension:plugin` through `isPatchEnabled`

## Members

| Member                        | Kind              | Purpose                                                                            |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `default`                     | plugin            | Registers the patch under the source plugin id and gates it on the switch          |
| `PATCH_MARKER`                | exported constant | Window key `__jp_markdown_viewer_toc_fix__` that makes a second activation a no-op |
| `SWITCH_KEY`                  | constant          | The settings schema key the gate reads                                             |
| `patchFragmentNavigation`     | helper            | Wraps the `text/html` renderer prototype `setFragment`                             |
| `scrollToFragment`            | helper            | Finds the fragment target and scrolls it into view                                 |
| `patchMarkdownViewerFragment` | helper            | Wraps a viewer's `setFragment` and re-applies the hash after a render              |
| `patchWidgetTOC`              | helper            | Connects a viewer's TOC model to its heading elements                              |
| `setupTOCNavigation`          | helper            | Patches the existing Markdown Viewer widgets and every widget added later          |
| `NAMED_ID_ATTRIBUTE`          | exported constant | `data-jupyter-id`, the anchor attribute the sanitizer leaves                       |
| `cleanFragment`               | exported function | Strips the leading `#` from a fragment                                             |
| `anchorAttribute`             | exported function | `id` or `data-jupyter-id`, from the sanitizer setting                              |
| `findFragmentTarget`          | exported function | Primary attribute query, fallback query, then a case-insensitive heading scan      |

## Tests

- **Jest** - asserts the fragment helpers, the switch gate, the renderer prototype patch and its stock fallback, the viewer wrapper's case-insensitive scroll and stock fallback, the TOC signal scroll, and the second-activation no-op
- **Galata** - sets the switch `false`, reloads and asserts the window marker is absent; sets it `true`, reloads and asserts the marker; then scrolls a title-case heading through a lowercase fragment, where the enabled patch moves the scroller and the disabled patch leaves it at the top
- **Limitation** - JupyterLab 4.6 resolves exact-case anchors in core, so the Galata test cannot show the original bug; the case-insensitive fallback and the window marker carry the proof
