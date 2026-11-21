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

import plugin from '../fixes/server-proxy-launcher';
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
    icon: (id: string) => `stock:${id}`,
    execute: async () => undefined
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

describe('server-proxy:open reload argument', () => {
  /** The id of the server-proxy tab, which stock gives its IFrame widget. */
  const TAB_ID = 'server-proxy:demo';

  /** The second URL, resolved against the jsdom base URL as stock resolves it. */
  const RELOADED_URL = 'http://localhost/proxy/1234/second.html';

  /**
   * Build a tab widget whose frame records every URL the wrapper loads.
   *
   * @returns The widget and the list of loaded URLs
   */
  function fakeTab(): { widget: any; loads: string[] } {
    const loads: string[] = [];
    const content = {
      set url(value: string) {
        loads.push(value);
      }
    };
    return { widget: { content }, loads };
  }

  /**
   * Install the patch over a stock execute that opens the tab when it is not
   * open and returns the given tab widget.
   *
   * @param widget - The widget stock execute returns
   * @returns The patched registry and the stock execute mock
   */
  async function install(
    widget: any
  ): Promise<{ commands: any; stock: jest.Mock }> {
    const commands = fakeCommands();
    const stock = jest.fn(async () => {
      if (!document.getElementById(TAB_ID)) {
        openTab();
      }
      return widget;
    });
    commands.execute = stock;
    await installServerProxyLauncherFix(commands, async () => ({
      server_processes: []
    }));
    return { commands, stock };
  }

  /**
   * Put the IFrame node of an open server-proxy tab into the page.
   */
  function openTab(): void {
    const node = document.createElement('div');
    node.id = TAB_ID;
    document.body.appendChild(node);
  }

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('ACC-PATCH-61-RELOAD-OPEN: reload loads the url in the open tab and leaves a tab it opens to stock', async () => {
    const { widget, loads } = fakeTab();
    const { commands, stock } = await install(widget);

    // No open tab: stock opens it with the URL, the wrapper loads nothing.
    const first = { id: TAB_ID, url: '/proxy/1234/first.html', reload: true };
    await expect(commands.execute('server-proxy:open', first)).resolves.toBe(
      widget
    );
    expect(loads).toEqual([]);

    // The tab the first call opened is open: reload loads the second URL.
    const second = { id: TAB_ID, url: '/proxy/1234/second.html', reload: true };
    await expect(commands.execute('server-proxy:open', second)).resolves.toBe(
      widget
    );
    expect(stock).toHaveBeenLastCalledWith('server-proxy:open', second);
    expect(loads).toEqual([RELOADED_URL]);
  });

  it('ACC-PATCH-62-RELOAD-STOCK: a call without reload reaches stock execute and leaves the frame url', async () => {
    const { widget, loads } = fakeTab();
    const { commands, stock } = await install(widget);
    openTab();

    const args = { id: TAB_ID, url: '/proxy/1234/second.html' };
    await expect(commands.execute('server-proxy:open', args)).resolves.toBe(
      widget
    );
    expect(stock).toHaveBeenCalledWith('server-proxy:open', args);
    expect(loads).toEqual([]);

    // Control: the same open tab loads the URL once reload is set.
    await commands.execute('server-proxy:open', { ...args, reload: true });
    expect(loads).toEqual([RELOADED_URL]);
  });

  it('ACC-PATCH-62-RELOAD-STOCK: with the switch off the reload argument does nothing', async () => {
    jest
      .spyOn(ServerConnection as any, 'makeSettings')
      .mockReturnValue({ baseUrl: 'http://localhost/' });
    jest
      .spyOn(ServerConnection as any, 'makeRequest')
      .mockResolvedValue({ ok: false, status: 404 });
    openTab();

    /**
     * Activate the plugin with the switch value, then run one reload call.
     *
     * @param enabled - The value of the patch switch
     * @returns The URLs the wrapper loaded into the open tab
     */
    async function reloadWithSwitch(enabled: boolean): Promise<string[]> {
      const { widget, loads } = fakeTab();
      const commands = fakeCommands();
      commands.execute = async () => widget;
      const registry = {
        load: async () => ({ get: () => ({ composite: enabled }) })
      };
      await plugin.activate({ commands } as any, registry as any);
      await commands.execute('server-proxy:open', {
        id: TAB_ID,
        url: '/proxy/1234/second.html',
        reload: true
      });
      return loads;
    }

    expect(await reloadWithSwitch(false)).toEqual([]);
    // Control: with the switch on the same call loads the URL.
    expect(await reloadWithSwitch(true)).toEqual([RELOADED_URL]);
  });
});
