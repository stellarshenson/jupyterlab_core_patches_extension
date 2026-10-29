/**
 * Restore syntax highlighting in rendered Markdown code blocks.
 *
 * Kept free of JupyterLab imports so it can be unit tested directly.
 */

/** Id of the injected highlight-style element, used to keep injection idempotent. */
export const HIGHLIGHT_STYLE_ID =
  'jupyterlab-markdown-syntax-rendering-fix-highlight';

/**
 * Inject the CodeMirror highlight StyleModule's CSS into `doc` so rendered
 * Markdown token spans are coloured.
 *
 * Rendered code blocks already carry the generated highlight classes (e.g.
 * `ͼs`), but the StyleModule that gives those classes their colours is only
 * mounted when a CodeMirror `EditorView` is instantiated. With only Markdown
 * previews open, no editor exists, so the spans inherit the plain code colour
 * and look unhighlighted. Mounting the rules once - the same effect as opening
 * the editor - colours every preview. Colours resolve through
 * `--jp-mirror-editor-*-color` CSS variables, so they track the active theme.
 *
 * Idempotent: a fixed element id means repeated calls are a no-op, and an empty
 * rule string is ignored.
 */
export function injectHighlightRules(
  rules: string,
  doc: Document = document
): void {
  if (!rules || doc.getElementById(HIGHLIGHT_STYLE_ID)) {
    return;
  }
  const style = doc.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = rules;
  (doc.head ?? doc.documentElement).appendChild(style);
}
