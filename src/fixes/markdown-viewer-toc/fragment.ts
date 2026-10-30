/**
 * Fragment lookup for the Markdown Viewer table-of-contents patch.
 *
 * Kept free of JupyterLab imports so the selector logic can be unit tested.
 */

/**
 * The attribute JupyterLab's sanitizer leaves on a heading when `id` is
 * stripped.
 */
export const NAMED_ID_ATTRIBUTE = 'data-jupyter-id';

/**
 * Strip the leading `#` from a URL fragment.
 *
 * @param fragment - The fragment, with or without the leading `#`
 * @returns The fragment without the leading `#`
 */
export function cleanFragment(fragment: string): string {
  return fragment.startsWith('#') ? fragment.slice(1) : fragment;
}

/**
 * The fragment readings to match, literal first and percent-decoded second.
 *
 * @param fragment - The fragment, with or without the leading `#`
 * @returns The literal reading, then the decoded reading when it differs
 */
function fragmentCandidates(fragment: string): string[] {
  const clean = cleanFragment(fragment);
  try {
    const decoded = decodeURIComponent(clean);
    return decoded === clean ? [clean] : [clean, decoded];
  } catch {
    return [clean];
  }
}

/**
 * The heading attribute that holds the anchor for the given sanitizer setting.
 *
 * @param allowNamedProperties - Whether the sanitizer keeps `id` attributes
 * @returns `id` when named properties are allowed, `data-jupyter-id` otherwise
 */
export function anchorAttribute(allowNamedProperties: boolean): string {
  return allowNamedProperties ? 'id' : NAMED_ID_ATTRIBUTE;
}

/**
 * Find the element a fragment points at.
 *
 * The literal fragment is tried first and the percent-decoded form second,
 * because `window.location.hash` is URL-serialized, so a heading with a
 * non-ASCII character reads back percent-encoded. For each candidate the
 * first query uses the attribute the sanitizer keeps, the second query uses
 * the other attribute. A final case-insensitive scan of every heading id
 * resolves URL fragments that are lowercase against heading ids that keep the
 * heading's title case.
 *
 * @param contentNode - The rendered document to search
 * @param fragment - The fragment, with or without the leading `#`
 * @param allowNamedProperties - Whether the sanitizer keeps `id` attributes
 * @returns The matching element, or `null` when no heading matches
 */
export function findFragmentTarget(
  contentNode: ParentNode,
  fragment: string,
  allowNamedProperties: boolean
): HTMLElement | null {
  let el: Element | null = null;
  try {
    const attribute = anchorAttribute(allowNamedProperties);
    for (const clean of fragmentCandidates(fragment)) {
      const escaped = CSS.escape(clean);

      el = contentNode.querySelector(
        allowNamedProperties ? `#${escaped}` : `[${attribute}="${escaped}"]`
      );
      if (!el) {
        el = contentNode.querySelector(
          allowNamedProperties ? `[${attribute}="${escaped}"]` : `#${escaped}`
        );
      }

      if (!el) {
        const cleanLower = clean.toLowerCase();
        const headings = contentNode.querySelectorAll(
          '[data-jupyter-id], [id]'
        );
        for (const heading of Array.from(headings)) {
          const headingId =
            heading.getAttribute(NAMED_ID_ATTRIBUTE) ||
            heading.getAttribute('id') ||
            '';
          if (headingId.toLowerCase() === cleanLower) {
            el = heading;
            break;
          }
        }
      }

      if (el) {
        break;
      }
    }
  } catch {
    return null;
  }

  return el as HTMLElement | null;
}
