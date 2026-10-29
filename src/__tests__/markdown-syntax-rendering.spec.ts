import {
  HIGHLIGHT_STYLE_ID,
  injectHighlightRules
} from '../fixes/markdown-syntax-rendering/highlight';

describe('injectHighlightRules', () => {
  afterEach(() => {
    document.getElementById(HIGHLIGHT_STYLE_ID)?.remove();
  });

  it('appends a style element carrying the rules', () => {
    injectHighlightRules('.ͼs{color:red}');
    const style = document.getElementById(HIGHLIGHT_STYLE_ID);
    expect(style).not.toBeNull();
    expect(style!.tagName).toBe('STYLE');
    expect(style!.textContent).toBe('.ͼs{color:red}');
  });

  it('is idempotent - a second call does not add another element', () => {
    injectHighlightRules('.ͼs{color:red}');
    injectHighlightRules('.ͼs{color:blue}');
    expect(document.querySelectorAll(`#${HIGHLIGHT_STYLE_ID}`)).toHaveLength(1);
    expect(document.getElementById(HIGHLIGHT_STYLE_ID)!.textContent).toBe(
      '.ͼs{color:red}'
    );
  });

  it('ignores an empty rule string', () => {
    injectHighlightRules('');
    expect(document.getElementById(HIGHLIGHT_STYLE_ID)).toBeNull();
  });
});
