"""Server patch for a file-browser delete to the trash.

jupyter_server 2.21.1 ``AsyncFileContentsManager.delete_file`` calls
``send2trash`` on the event loop. When the path and the home trash are two bind
mounts of one disk, both report the same ``st_dev`` and ``os.path.ismount`` is
False, so send2trash picks the home trash, ``os.rename`` fails with EXDEV and
send2trash copies the whole item while the server answers no request.

The wrapper runs the trash call in a worker thread. A path on a mount other
than the home trash's mount is renamed into that mount's own ``.Trash-<uid>``
folder; the mounts come from ``/proc/self/mountinfo``. Every other path, and
every mount trash that cannot be found or created, goes through the stock
``send2trash``. A failed rename into the mount trash is raised, and nothing is
copied.
"""

import functools
import os
import os.path as op
import re
import sys
import threading

from anyio.to_thread import run_sync
from jupyter_core.paths import is_hidden
from jupyter_server.services.contents import filemanager
from send2trash import plat_other
from tornado import web

from jupyterlab_core_patches_extension.settings import patch_enabled

# The switch key in the shared settings schema. No frontend plugin reads it.
SWITCH_KEY = "jupyterlab_file_delete_trash_fix"

# Class attribute that holds the pristine delete_file. Every patch call wraps
# this saved function, so a second call does not wrap twice and a re-imported
# module (a soft reload) installs its own wrapper.
_ORIGINAL = "_jp_file_delete_trash_original"

# An octal escape in a mountinfo field, such as \040 for a space.
_OCTAL = re.compile(r"\\([0-7]{3})")

# Held around every trash move. send2trash picks a free name in the trash and
# then renames onto it, so two parallel moves can pick one name and the second
# rename replaces the first item. The stock method ran the moves one by one on
# the event loop; this lock keeps them one by one in the worker threads.
_TRASH_LOCK = threading.Lock()


def _mounts():
    """Return the mount points listed in ``/proc/self/mountinfo``, in file order.

    Returns:
        The mount point field of every line with its octal escapes decoded

    Raises:
        OSError: The file cannot be read
    """
    with open("/proc/self/mountinfo", "rb") as f:
        text = os.fsdecode(f.read())
    return [
        _OCTAL.sub(lambda m: chr(int(m.group(1), 8)), line.split()[4])
        for line in text.splitlines()
    ]


def _mount_point(path, mounts):
    """Return the mount of ``path``: the longest mount point that is a path prefix.

    shortcut: a mount hidden by a later mount on a parent folder still matches;
    compare the mnt_id of /proc/self/fdinfo if a deployment stacks mounts so.

    Args:
        path: An absolute path with no symlink in its folders
        mounts: The mount points from :func:`_mounts`

    Returns:
        The mount point that holds ``path``
    """
    best = "/"
    for mount in mounts:
        inside = path == mount or path.startswith(mount.rstrip("/") + "/")
        if inside and len(mount) >= len(best):
            best = mount
    return best


def _home_trash_dir():
    """Return the home trash folder of send2trash, or its nearest existing parent."""
    path = op.realpath(os.fsdecode(plat_other.HOMETRASH_B))
    while not op.exists(path):
        path = op.dirname(path)
    return path


def _trash(os_path):
    """Move ``os_path`` to a trash folder, by rename where send2trash would copy.

    The parent folder is resolved and the final name kept, so a symlink is
    trashed itself and the ``.trashinfo`` Path holds no ``..``. A path on the
    mount of the home trash goes through the stock ``send2trash``, looked up on
    the jupyter_server module at call time. A path on another mount is renamed
    into that mount's trash folder; when that trash folder cannot be found or
    created, or ``/proc`` cannot be read, the stock ``send2trash`` runs instead.
    A failed rename into the mount trash is raised, so the item stays in place
    and nothing is copied. The whole move holds ``_TRASH_LOCK``, so parallel
    deletes never pick one trash name.

    Args:
        os_path: The absolute path of the file or folder to trash

    Raises:
        OSError: The stock ``send2trash`` or the rename into the mount trash failed
    """
    with _TRASH_LOCK:
        src = op.join(op.realpath(op.dirname(os_path)), op.basename(os_path))
        dst = None
        try:
            mounts = _mounts()
            top = _mount_point(src, mounts)
            if top != _mount_point(_home_trash_dir(), mounts):
                top_b = os.fsencode(top)
                dst = plat_other.find_ext_volume_trash(top_b)
        except OSError:
            pass  # the mount trash cannot be used: the stock path copies as before
        if dst is None:
            filemanager.send2trash(os_path)
        else:
            plat_other.trash_move(os.fsencode(src), dst, top_b)


def _make_delete_file(server_app, original):
    """Return the ``delete_file`` wrapper around ``original``.

    Args:
        server_app: The JupyterLab application passed to the server extension
        original: The pristine ``AsyncFileContentsManager.delete_file``

    Returns:
        The coroutine function installed on the class
    """

    @functools.wraps(original)
    async def delete_file(self, path):
        if (
            not patch_enabled(server_app, SWITCH_KEY)
            or not self.delete_to_trash
            or sys.platform != "linux"
        ):
            return await original(self, path)
        # The stock checks of the trash branch, in stock order and wording
        path = path.strip("/")
        os_path = self._get_os_path(path)
        if not self.allow_hidden and is_hidden(os_path, self.root_dir):
            raise web.HTTPError(400, f"Cannot delete file or directory {os_path!r}")
        if not os.path.exists(os_path):
            raise web.HTTPError(404, "File or directory does not exist: %s" % os_path)
        if not self.is_writable(path):
            raise web.HTTPError(403, "Permission denied: %s" % path) from None
        self.log.debug("Sending %s to trash", os_path)
        try:
            await run_sync(_trash, os_path)
        except OSError as e:
            raise web.HTTPError(400, "send2trash failed: %s" % e) from e

    return delete_file


def patch_contents_manager(server_app):
    """Wrap ``AsyncFileContentsManager.delete_file`` for the trash fix.

    The wrapper reads the switch through :func:`patch_enabled` on every delete
    and awaits the original method when the switch is off, when
    ``delete_to_trash`` is false or off Linux. ``AsyncLargeFileManager``, the
    default contents manager, inherits the wrapper.

    Args:
        server_app: The JupyterLab application passed to the server extension
    """
    cls = filemanager.AsyncFileContentsManager
    original = cls.__dict__.get(_ORIGINAL, cls.delete_file)
    setattr(cls, _ORIGINAL, original)
    cls.delete_file = _make_delete_file(server_app, original)
    server_app.log.info(
        "jupyterlab_file_delete_trash_fix: Patched AsyncFileContentsManager.delete_file"
    )
