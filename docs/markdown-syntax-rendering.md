# Markdown syntax rendering

Restores syntax-highlight colours in rendered Markdown fenced code blocks when no CodeMirror editor is open. This page documents the `markdown-syntax-rendering` patch, a direct replacement for the discrete `jupyterlab_markdown_syntax_rendering_fix` package.

- **Switch** - `jupyterlab_markdown_syntax_rendering_fix`, boolean, default `true`; a change applies on the next page reload
- **Plugin id** - `jupyterlab_markdown_syntax_rendering_fix:plugin`
- **Patched member** - `jupyterHighlightStyle.module.getRules()` from `@jupyterlab/codemirror`; the returned CSS is injected into one `<style>` element in the document head
- **Guard** - fixed style element id `jupyterlab-markdown-syntax-rendering-fix-highlight`; a second injection finds the element and returns, and an empty rule string is ignored
- **Source** - `jupyterlab_markdown_syntax_rendering_fix` version 1.0.2
- **Jest test** - `src/__tests__/markdown-syntax-rendering.spec.ts`
- **Galata test** - `ui-tests/tests/markdown-syntax-rendering.spec.ts`

## Mechanism

JupyterLab's Markdown renderer emits token spans with CodeMirror highlight classes (e.g. `ͼs`), but the StyleModule that colours those classes mounts only when an `EditorView` is created. In a session with only Markdown previews open no editor exists, so every span inherits the plain code colour.

- **Startup** - the plugin reads the rules once from `jupyterHighlightStyle.module.getRules()` and appends them as text to one style element
- **Effect** - every rendered fenced block resolves its highlight classes through the injected rules, the same result as opening an editor
- **Theme** - the rules use `--jp-mirror-editor-*-color` variables, so colours follow the active theme
- **Scope** - frontend only, with no server part
- **Stylesheet** - none; the patch injects a style element at runtime
- **Switch off** - `activate` returns before reading the rules, so the document keeps the stock plain colour

## Members

| Member                             | Type                          | Purpose                                                                                   |
| ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| default export `plugin`            | `JupyterFrontEndPlugin<void>` | Reads the switch, logs activation and injects the highlight rules                         |
| `HIGHLIGHT_STYLE_ID`               | `string` constant             | Fixed id of the injected style element and the double-patch guard                         |
| `injectHighlightRules(rules, doc)` | function                      | Appends one style element carrying the rules; no-op on empty rules or an existing element |

## Tests

- **Jest** - asserts the style element text, the second-call no-op and the empty-rule no-op
- **Galata** - sets the switch `false`, reloads and asserts the style element is absent; sets it `true`, reloads and asserts the element carries `ͼ` rules and colours a `.ͼs` span
- **Limitation** - the stock bug needs a session where no CodeMirror editor ever mounted the StyleModule; Galata may open editors, so the UI test asserts the patch's own style element
