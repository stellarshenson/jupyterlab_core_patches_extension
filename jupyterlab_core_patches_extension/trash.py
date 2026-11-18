"""Mount and trash-folder helpers shared by the server patch and the trash-put command."""

import os
import os.path as op
import re

from send2trash import plat_other

# An octal escape in a mountinfo field, such as \040 for a space.
_OCTAL = re.compile(r"\\([0-7]{3})")


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
