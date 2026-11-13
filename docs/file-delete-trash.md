# File delete to trash

Keeps the server answering while a file browser delete moves an item to the trash, and moves an item on another mount into that mount's own trash folder by rename instead of copying it into the home trash. This patch has no discrete source package. It was added on 2026-11-13, after a file browser delete of a 177 GB folder in the workspace left the lab without an answer for 14.5 minutes.

jupyter_server 2.21.1 `AsyncFileContentsManager.delete_file` calls `send2trash` directly on the event loop. When the home folder, the workspace and the cache are bind mounts of one disk, all three report the same `st_dev`, and `os.path.ismount` returns False for the bind mounts. send2trash then picks the home trash, `os.rename` fails with EXDEV, and send2trash copies the whole item. The server answers no request until the copy ends.

- **Switch** - `jupyterlab_file_delete_trash_fix`, boolean, default `true`. The wrapper reads the switch on every delete, so a change applies at the next delete, without a page reload or a server restart
- **Plugin id** - none - server only
- **Patched member** - `jupyter_server.services.contents.filemanager.AsyncFileContentsManager.delete_file`, wrapped on the class. `AsyncLargeFileManager`, the default contents manager, inherits the wrapper
- **Guard** - the class attribute `AsyncFileContentsManager._jp_file_delete_trash_original` holds the pristine `delete_file`. Every `patch_contents_manager` call wraps that saved function, never the current attribute, so a second call keeps one wrapper level and a module imported again by a soft reload installs its own wrapper
- **Source** - `jupyterlab_core_patches_extension/server/file_delete_trash.py`
- **Pytest** - `jupyterlab_core_patches_extension/tests/test_file_delete_trash.py`. One test per behaviour: the event loop keeps running during a slow trash call, two parallel deletes keep both items in the trash, a cross-mount delete is a rename on simulated mounts and on real bind mounts under bubblewrap, the trashinfo Path through a symlinked parent, the fallback to the stock trash, the stock HTTP answers, the switch and `delete_to_trash` gates, and one wrapper level after a second call and after a module import
- **Jest test** - none - server only
- **Galata test** - `ui-tests/tests/file-delete-trash.spec.ts`. A file deleted from the file browser context menu leaves the listing and appears in the trash folder of its mount: `<root mount>/.Trash-<uid>/files` when the server root and the home trash are on different mounts, `$HOME/.local/share/Trash/files` otherwise

## Behaviour

- **Worker thread** - the trash call runs through `anyio.to_thread.run_sync`; the event loop answers other requests while it runs
- **One move at a time** - every trash move holds one module lock, `_TRASH_LOCK`, in the worker thread. send2trash picks a free name in the trash and then renames onto it, so two parallel deletes, such as a multi-select delete in the file browser, could pick one name, and the second rename would replace the first item. The stock method ran the moves one after another on the event loop; the lock keeps that order without blocking the event loop
- **Mount trash** - the mounts of the path and of the home trash come from `/proc/self/mountinfo`: the longest mount point that is a path prefix, with octal escapes such as `\040` decoded. On different mounts the item is renamed into `<mount>/.Trash-<uid>`, or into `<mount>/.Trash/<uid>` where a sticky `.Trash` folder exists, through send2trash's own `find_ext_volume_trash` and `trash_move`. Nothing is copied and nothing is added to the home trash
- **Same mount** - the stock `send2trash` runs, in the worker thread
- **Trashinfo path** - the parent folder is resolved before the move and the final name is kept, so a symlink is trashed itself and the `.trashinfo` Path holds no `..`, also through a symlinked parent folder such as `~/workspace/.cache`
- **Fallback** - when the mount trash cannot be found or created, such as on a mount root that is not writable, or when `/proc` cannot be read, the stock `send2trash` runs
- **Failed rename** - a failed rename into the mount trash, such as EACCES under a read-only parent folder, does not fall back: the wrapper answers 400 `send2trash failed: <error>`, the item stays in place and nothing is copied
- **Stock answers** - 400 for a hidden path unless `allow_hidden` is true, 404 for a missing path, 403 for a path that is not writable, 400 `send2trash failed: <error>` when the trash call fails, 204 on success
- **Stock delete** - the original `delete_file` runs unchanged when the switch is off, when `delete_to_trash` is false, or when the platform is not Linux
- **Apply time** - a switch change applies at the next delete

## Server part

The module exports `patch_contents_manager(server_app)` and registers no HTTP route. `load_server_patches` in `routes.py` calls it from `_load_jupyter_server_extension`. The patch never replaces a send2trash module global, because other extensions in the same server call send2trash.

## Limits

- **Trash panel** - a trash panel that lists only the home trash does not show an item moved into a mount trash, such as `~/workspace/.Trash-1000`, and emptying that panel does not free the item
- **Git work tree** - a mount trash folder inside a git work tree is listed as untracked until `.Trash-*` is in its `.gitignore`
- **Hidden mount** - a mount hidden by a later mount on a parent folder still matches the path prefix; such a path is renamed into a `.Trash-<uid>` folder that is not at a mount root
- **Fallback copy** - when the mount trash cannot be found or created, the stock `send2trash` still copies a cross-mount item into the home trash; the copy runs in the worker thread, so the server answers, but the disk holds the item twice until the copy ends
- **Copied checks** - the wrapper repeats the stock checks of the trash branch; a later jupyter_server change to them is not followed, and `test_stock_error_answers_kept` fails on a change to the tested answers
- **Sync manager** - the synchronous `FileContentsManager.delete_file` is not patched; it is not the default contents manager
- **Linux only** - the mount trash reads `/proc`; on other platforms the original `delete_file` runs

## Members

| Member                   | File                                                            | Purpose                                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patch_contents_manager` | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | Saves the pristine `delete_file` once and installs a wrapper around it                                                                                                                                                                        |
| `_make_delete_file`      | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | Builds the wrapper around the saved original                                                                                                                                                                                                  |
| `delete_file`            | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | Wrapper: gates on the switch, repeats the stock checks and runs `_trash` in a worker thread                                                                                                                                                   |
| `_trash`                 | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | Renames a cross-mount item into its mount trash; calls the stock `send2trash` on the mount of the home trash, or when that trash folder cannot be found or created, or `/proc` cannot be read; a failed rename into the mount trash is raised |
| `_mounts`                | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | Reads the mount points of `/proc/self/mountinfo` with octal escapes decoded                                                                                                                                                                   |
| `_mount_point`           | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | Returns the longest mount point that is a path prefix                                                                                                                                                                                         |
| `_home_trash_dir`        | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | Returns the home trash folder of send2trash, or its nearest existing parent                                                                                                                                                                   |
| `SWITCH_KEY`             | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | The settings key the wrapper gates on                                                                                                                                                                                                         |
| `_ORIGINAL`              | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | The name of the class attribute that holds the pristine `delete_file`                                                                                                                                                                         |
| `_OCTAL`                 | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | The pattern of an octal escape in a mountinfo field                                                                                                                                                                                           |
| `_TRASH_LOCK`            | `jupyterlab_core_patches_extension/server/file_delete_trash.py` | The lock every trash move holds, so parallel deletes never pick one trash name                                                                                                                                                                |
