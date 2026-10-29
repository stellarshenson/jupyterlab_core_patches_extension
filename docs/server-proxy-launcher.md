# Server proxy launcher icons

Renders the SVG icons of jupyter-server-proxy launchers that sit in a custom category. The patch fetches `/server-proxy/servers-info` once at activation, builds one `LabIcon` per enabled non-kernel launcher entry, and wraps `app.commands.icon` to answer `server-proxy:open` from that cache.

This page documents the `server-proxy-launcher` patch inside `jupyterlab_core_patches_extension`, the direct replacement for the `stellars_jupyterlab_fixes` metapackage and for the discrete `jupyterlab_server_proxy_launcher_fix` package. Uninstall both before installing this extension, because two installed copies apply every patch twice.

- **Switch**: `jupyterlab_server_proxy_launcher_fix`, boolean, default `true`; a change applies on the next page reload
- **Plugin id**: `jupyterlab_server_proxy_launcher_fix:plugin`
- **Patched member**: `app.commands.icon` on the `JupyterFrontEnd` command registry
- **Guard**: the registry property `__serverProxyLauncherFixPatched`, set before the fetch; a second install returns `false` and leaves the installed wrapper in place. The source package had no guard
- **Source**: `/home/lab/workspace/private/jupyterlab/jupyterlab_server_proxy_launcher_fix`
- **Jest test**: `src/__tests__/server-proxy-launcher.spec.ts`
- **Galata test**: `ui-tests/tests/server-proxy-launcher.spec.ts`

## Behaviour

- **Stock behaviour** - a Notebook or Console entry renders through `kernelIconUrl`; any other category calls `app.commands.icon`, and `server-proxy:open` declares no icon
- **Cache keys** - the launcher title, and the title with the ` [↗]` suffix that server-proxy appends when `new_browser_tab` is `true`
- **Icon source** - the entry `icon_url` when its body holds an `<svg>`; otherwise a text icon built from the first letter of the title
- **Skipped entries** - `enabled: false`, and the `Notebook` and `Console` categories, which render through `kernelIconUrl`
- **Missing endpoint** - a 404 from `/server-proxy/servers-info` leaves the cache empty and still installs the wrapper, so every call falls through to the stock icon
- **Other commands** - every command other than `server-proxy:open`, and every title that is not cached, delegates to the stock `icon` method
- **Failure** - `activate` catches a fetch error and does nothing, because the source treats the extension as non-critical
- **Scope** - frontend only, no server part, no stylesheet

## Port notes

- **Server part** - none; the source server module registers only the scaffold `hello` route, which is dropped
- **CSS** - none; the source stylesheet holds only the scaffold comment, so the patch adds no body class
- **Settings source** - the source schema is empty; the port reads the shared switch through `isPatchEnabled`
- **Double patch** - the source has no guard; the port marks the command registry, and a second `installServerProxyLauncherFix` call is a no-op
- **Old package** - the marker detects only this port. With the discrete package still installed, both extensions wrap `commands.icon` and each answers from its own cache

## Members

| Member                          | Kind                                          | Purpose                                                                    |
| ------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| `plugin`                        | default export, `JupyterFrontEndPlugin<void>` | Reads the switch, logs activation and installs the patch                   |
| `SWITCH_KEY`                    | constant                                      | The settings schema key the gate reads                                     |
| `installServerProxyLauncherFix` | exported function                             | Fetches the configuration, caches the icons and wraps `commands.icon` once |
| `PATCH_MARKER`                  | exported constant                             | Registry property that makes a second install a no-op                      |
| `SERVER_PROXY_COMMAND`          | constant                                      | `server-proxy:open`, the only command the wrapper answers                  |
| `iconCache`                     | module constant                               | Launcher icons keyed by command title                                      |
| `cacheLauncherIcons`            | helper function                               | Fills the cache from the `server_processes` list                           |
| `wrapCommandsIcon`              | helper function                               | Installs the icon wrapper over the stock method                            |
| `fetchSvgIcon`                  | exported function                             | Fetches an SVG body and builds a `LabIcon`; `null` on any failure          |
| `createTextIcon`                | exported function                             | Builds a fallback icon from the first letter of the title                  |
| `isKernelCategory`              | exported function                             | Whether a category is `Notebook` or `Console`                              |
| `fetchServersInfo`              | exported function                             | Fetches `/server-proxy/servers-info`; an empty list on 404                 |
| `KERNEL_CATEGORIES`             | constant                                      | `Notebook` and `Console`, the categories that need no fix                  |
| `ILauncherEntry`                | exported interface                            | One launcher entry from jupyter-server-proxy                               |
| `IServerProcess`                | exported interface                            | One server process from jupyter-server-proxy                               |
| `IServersInfo`                  | exported interface                            | The `/server-proxy/servers-info` response                                  |

## Limits

- **Galata scope** - the test serves one launcher entry from a route mock and asserts the icon the wrapper returns for its title, because a real entry needs a configured server process
- **Activation time** - icons are cached once at activation; a launcher added to the server configuration needs a page reload
- **Title match** - the cache key is the exact `args.title`, including the ` [↗]` suffix
- **JupyterLab version** - the patch wraps the public `CommandRegistry.icon` method; a future JupyterLab that changes its signature needs a new port
