/**
 * The patch reaches `@jupyterlab/ui-components` only through `LabIcon`, and
 * the real module loads untransformed ESM from `@jupyter/react-components`.
 * The test supplies a minimal LabIcon class instead.
 */
jest.mock('@jupyterlab/ui-components', () => ({
  LabIcon: class {
    name: string;
    svgstr: string;
    constructor(options: { name: string; svgstr: string }) {
      this.name = options.name;
      this.svgstr = options.svgstr;
    }
  }
}));

import { ServerConnection } from '@jupyterlab/services';
import { LabIcon } from '@jupyterlab/ui-components';

import {
  createTextIcon,
  fetchSvgIcon
} from '../fixes/server-proxy-launcher/iconUtils';
import {
  installServerProxyLauncherFix,
  PATCH_MARKER
} from '../fixes/server-proxy-launcher/patch';
import {
  fetchServersInfo,
  isKernelCategory,
  IServerProcess
} from '../fixes/server-proxy-launcher/serverInfo';

/**
 * Build one entry of the `server_processes` list.
 *
 * @param name - The server process name, used in the LabIcon name
 * @param title - The launcher title, which is the cache key
 * @param options - Entry fields that differ from the defaults
 * @returns The server process entry
 */
function processEntry(
  name: string,
  title: string,
  options: {
    enabled?: boolean;
    category?: string;
    iconUrl?: string;
    newBrowserTab?: boolean;
  } = {}
): IServerProcess {
  return {
    name,
    new_browser_tab: options.newBrowserTab ?? false,
    launcher_entry: {
      enabled: options.enabled ?? true,
      title,
      path_info: `/${name}`,
      icon_url: options.iconUrl,
      category: options.category ?? 'Services'
    }
  };
}

/**
 * Build a command registry stub whose stock icon method returns a marker
 * string that tells a delegated call apart from a cached icon.
 *
 * @returns The registry stub
 */
function fakeCommands(): any {
  return {
    icon: (id: string) => `stock:${id}`
  };
}

describe('isKernelCategory', () => {
  it('treats Notebook and Console as kernel categories', () => {
    expect(isKernelCategory('Notebook')).toBe(true);
    expect(isKernelCategory('Console')).toBe(true);
  });

  it('treats a custom category and a missing category as non-kernel', () => {
    expect(isKernelCategory('Services')).toBe(false);
    expect(isKernelCategory(undefined)).toBe(false);
  });
});

describe('createTextIcon', () => {
  it('uses the first letter of the title, upper-cased', () => {
    const icon = createTextIcon('server-proxy-launcher-fix:demo', 'demo');
    expect(icon.name).toBe('server-proxy-launcher-fix:demo');
    expect(icon.svgstr).toContain('>D<');
  });

  it('uses a question mark for an empty title', () => {
    expect(createTextIcon('empty', '').svgstr).toContain('>?<');
  });
});

describe('fetchSvgIcon', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('creates an icon from an SVG response', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '<svg><rect/></svg>'
    })) as any;

    const icon = await fetchSvgIcon('http://example.test/icon.svg', 'remote');

    expect(icon).not.toBeNull();
    expect(icon!.name).toBe('remote');
    expect(icon!.svgstr).toContain('<svg>');
  });

  it('returns null for a response that is not ok', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false })) as any;

    await expect(
      fetchSvgIcon('http://example.test/icon.svg', 'remote')
    ).resolves.toBeNull();
  });

  it('returns null when the body holds no SVG', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => 'not an svg'
    })) as any;

    await expect(
      fetchSvgIcon('http://example.test/icon.svg', 'remote')
    ).resolves.toBeNull();
  });

  it('returns null when the request rejects', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('down');
    }) as any;

    await expect(
      fetchSvgIcon('http://example.test/icon.svg', 'remote')
    ).resolves.toBeNull();
  });
});

describe('fetchServersInfo', () => {
  beforeEach(() => {
    jest
      .spyOn(ServerConnection as any, 'makeSettings')
      .mockReturnValue({ baseUrl: 'http://localhost:8888/' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns an empty list when the endpoint is absent', async () => {
    jest
      .spyOn(ServerConnection as any, 'makeRequest')
      .mockResolvedValue({ ok: false, status: 404 });

    await expect(fetchServersInfo()).resolves.toEqual({ server_processes: [] });
  });

  it('returns the parsed server list', async () => {
    const info = { server_processes: [] };
    jest.spyOn(ServerConnection as any, 'makeRequest').mockResolvedValue({
      ok: true,
      json: async () => info
    });

    await expect(fetchServersInfo()).resolves.toBe(info);
  });

  it('throws a ResponseError for another failed status', async () => {
    jest.spyOn(ServerConnection as any, 'makeRequest').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error'
    });

    await expect(fetchServersInfo()).rejects.toBeInstanceOf(
      ServerConnection.ResponseError
    );
  });

  it('throws a NetworkError when the request itself fails', async () => {
    jest
      .spyOn(ServerConnection as any, 'makeRequest')
      .mockRejectedValue(new Error('down'));

    await expect(fetchServersInfo()).rejects.toBeInstanceOf(
      ServerConnection.NetworkError
    );
  });
});

describe('installServerProxyLauncherFix', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('caches an enabled custom-category launcher and answers server-proxy:open', async () => {
    const commands = fakeCommands();

    const installed = await installServerProxyLauncherFix(
      commands,
      async () => ({
        server_processes: [processEntry('demo', 'Demo Service')]
      })
    );

    expect(installed).toBe(true);
    const icon = commands.icon('server-proxy:open', { title: 'Demo Service' });
    expect(icon).toBeInstanceOf(LabIcon);
    expect(icon.name).toBe('server-proxy-launcher-fix:demo');
  });

  it('skips disabled entries and kernel categories', async () => {
    const commands = fakeCommands();
    await installServerProxyLauncherFix(commands, async () => ({
      server_processes: [
        processEntry('off', 'Disabled Service', { enabled: false }),
        processEntry('note', 'Notebook Launcher', { category: 'Notebook' }),
        processEntry('console', 'Console Launcher', { category: 'Console' })
      ]
    }));

    for (const title of [
      'Disabled Service',
      'Notebook Launcher',
      'Console Launcher'
    ]) {
      expect(commands.icon('server-proxy:open', { title })).toBe(
        'stock:server-proxy:open'
      );
    }
  });

  it('caches the new_browser_tab title suffix', async () => {
    const commands = fakeCommands();
    await installServerProxyLauncherFix(commands, async () => ({
      server_processes: [
        processEntry('tabbed', 'Tabbed Service', { newBrowserTab: true }),
        processEntry('plain', 'Plain Service')
      ]
    }));

    const tabbedIcon = commands.icon('server-proxy:open', {
      title: 'Tabbed Service'
    });
    expect(
      commands.icon('server-proxy:open', { title: 'Tabbed Service [↗]' })
    ).toBe(tabbedIcon);
    expect(
      commands.icon('server-proxy:open', { title: 'Plain Service [↗]' })
    ).toBe('stock:server-proxy:open');
  });

  it('delegates every other command and title to the stock icon method', async () => {
    const commands = fakeCommands();
    await installServerProxyLauncherFix(commands, async () => ({
      server_processes: [processEntry('demo', 'Demo Service')]
    }));

    expect(commands.icon('other:command', { title: 'Demo Service' })).toBe(
      'stock:other:command'
    );
    expect(commands.icon('server-proxy:open', { title: 'Unknown' })).toBe(
      'stock:server-proxy:open'
    );
    expect(commands.icon('server-proxy:open')).toBe('stock:server-proxy:open');
  });

  it('falls back to a text icon when the icon URL cannot be fetched', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false })) as any;
    const commands = fakeCommands();

    await installServerProxyLauncherFix(commands, async () => ({
      server_processes: [
        processEntry('demo', 'Demo Service', {
          iconUrl: 'http://example.test/missing.svg'
        })
      ]
    }));

    const icon = commands.icon('server-proxy:open', { title: 'Demo Service' });
    expect(icon.name).toBe('server-proxy-launcher-fix:demo');
    expect(icon.svgstr).toContain('>D<');
  });

  it('caches the fetched SVG when the icon URL answers', async () => {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '<svg><circle/></svg>'
    })) as any;
    const commands = fakeCommands();

    await installServerProxyLauncherFix(commands, async () => ({
      server_processes: [
        processEntry('demo', 'Demo Service', {
          iconUrl: 'http://example.test/icon.svg'
        })
      ]
    }));

    const icon = commands.icon('server-proxy:open', { title: 'Demo Service' });
    expect(icon.svgstr).toContain('<circle/>');
  });

  it('is a no-op when the registry already carries the marker', async () => {
    const commands = fakeCommands();
    const load = jest.fn(async () => ({ server_processes: [] }));

    expect(await installServerProxyLauncherFix(commands, load)).toBe(true);
    const wrapper = commands.icon;
    expect(commands[PATCH_MARKER]).toBe(true);

    expect(await installServerProxyLauncherFix(commands, load)).toBe(false);
    expect(commands.icon).toBe(wrapper);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
