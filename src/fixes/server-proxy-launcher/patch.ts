import { LabIcon } from '@jupyterlab/ui-components';

import { createTextIcon, fetchSvgIcon } from './iconUtils';
import {
  fetchServersInfo,
  isKernelCategory,
  IServerProcess,
  IServersInfo
} from './serverInfo';

/**
 * The command whose icon the wrapper answers from the launcher icon cache.
 */
const SERVER_PROXY_COMMAND = 'server-proxy:open';

/**
 * The marker set on the command registry once the icon wrapper is installed.
 * A second install call reads it and returns `false`, so a duplicated package
 * cannot wrap the stock method twice.
 */
export const PATCH_MARKER = '__serverProxyLauncherFixPatched';

/**
 * Launcher icons keyed by the title passed to `server-proxy:open`.
 */
const iconCache = new Map<string, LabIcon>();

/**
 * Fill the icon cache from the server-proxy launcher entries.
 *
 * Disabled entries and kernel categories are skipped. An entry with a usable
 * SVG at `icon_url` caches that icon; any other entry caches a text icon built
 * from the first letter of its title. An entry with `new_browser_tab` also
 * caches its icon under the ` [↗]` title suffix that server-proxy appends.
 *
 * @param serverProcesses - The `server_processes` list from `/server-proxy/servers-info`
 */
async function cacheLauncherIcons(
  serverProcesses: IServerProcess[]
): Promise<void> {
  for (const sp of serverProcesses) {
    if (!sp.launcher_entry.enabled) {
      continue;
    }
    const category = sp.launcher_entry.category || 'Other';
    if (isKernelCategory(category)) {
      continue;
    }

    const iconName = `server-proxy-launcher-fix:${sp.name}`;
    let icon = sp.launcher_entry.icon_url
      ? await fetchSvgIcon(sp.launcher_entry.icon_url, iconName)
      : null;

    if (!icon) {
      icon = createTextIcon(iconName, sp.launcher_entry.title);
    }

    // Cache by title - matches args.title in server-proxy:open calls.
    // server-proxy appends " [↗]" when new_browser_tab is true.
    const title = sp.launcher_entry.title;
    iconCache.set(title, icon);
    if (sp.new_browser_tab) {
      iconCache.set(`${title} [↗]`, icon);
    }
  }
}

/**
 * Wrap `commands.icon` so `server-proxy:open` returns a cached launcher icon
 * and every other call keeps the stock resolution.
 *
 * @param commands - The command registry to patch
 */
function wrapCommandsIcon(commands: any): void {
  const originalIcon = commands.icon.bind(commands);
  commands.icon = (id: string, args: any = {}) => {
    if (
      id === SERVER_PROXY_COMMAND &&
      args.title &&
      iconCache.has(args.title)
    ) {
      return iconCache.get(args.title);
    }
    return originalIcon(id, args);
  };
}

/**
 * Install the launcher icon patch on one command registry: fetch the
 * server-proxy configuration, cache one icon per non-kernel launcher entry and
 * wrap `commands.icon`.
 *
 * @param commands - The command registry whose `icon` method is wrapped
 * @param loadServersInfo - Fetches the server-proxy configuration; defaults to
 * {@link fetchServersInfo}
 * @returns `true` when the patch was installed, `false` when the registry
 * already carries {@link PATCH_MARKER}
 */
export async function installServerProxyLauncherFix(
  commands: any,
  loadServersInfo: () => Promise<IServersInfo> = fetchServersInfo
): Promise<boolean> {
  if (commands[PATCH_MARKER]) {
    return false;
  }
  commands[PATCH_MARKER] = true;

  const serversInfo = await loadServersInfo();
  await cacheLauncherIcons(serversInfo.server_processes || []);
  wrapCommandsIcon(commands);
  return true;
}
