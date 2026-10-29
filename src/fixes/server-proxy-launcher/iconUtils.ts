import { LabIcon } from '@jupyterlab/ui-components';

/**
 * Fetch an SVG icon from a URL and create a LabIcon.
 *
 * @param url - The URL to fetch the SVG from; it already includes the base path from server-proxy
 * @param name - Unique name for the LabIcon
 * @returns A LabIcon instance, or `null` when the fetch fails or the body holds no SVG
 */
export async function fetchSvgIcon(
  url: string,
  name: string
): Promise<LabIcon | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const svgstr = await response.text();
    if (!svgstr.includes('<svg')) {
      return null;
    }

    return new LabIcon({ name, svgstr });
  } catch {
    return null;
  }
}

/**
 * Create a simple text-based fallback icon using the first letter of the title.
 *
 * @param name - Unique name for the LabIcon
 * @param title - The title to derive the letter from
 * @returns A LabIcon with a simple letter icon
 */
export function createTextIcon(name: string, title: string): LabIcon {
  const letter = title.charAt(0).toUpperCase() || '?';
  const svgstr = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect x="2" y="2" width="20" height="20" rx="3" fill="#8888" stroke="#666" stroke-width="1"/>
  <text x="12" y="17" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="bold" fill="#333">${letter}</text>
</svg>`;
  return new LabIcon({ name, svgstr });
}
