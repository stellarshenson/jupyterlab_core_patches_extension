"""Console script that trashes a cross-mount item by rename.

The stock ``trash-put`` of trash-cli follows the freedesktop trash spec, which
compares device numbers. When the home folder and a workspace are bind mounts
of one disk, both report one device, so the stock command copies a cross-mount
item into the home trash. This script reuses the mount helpers of
``jupyterlab_core_patches_extension.trash``: a plain path on another mount is
renamed into that mount's own ``.Trash-<uid>`` folder. Every other case is
passed unchanged to ``/usr/bin/trash-put``, so options, same-mount paths and an
unusable mount trash keep the stock behaviour and exit code.
"""

import os
import os.path as op
import subprocess
import sys

from send2trash import plat_other

from ..trash import _home_trash_dir, _mount_point, _mounts

# The stock command of trash-cli. The console script of this package precedes
# it on the lab PATH and calls it for every case it does not rename itself.
STOCK = "/usr/bin/trash-put"

USAGE = """\
usage: trash-put [--help] [PATH ...]

Move files and folders to the trash.

A path on another mount than the home trash's mount is a cross-mount path: it
is renamed into <mount>/.Trash-<uid> with a .trashinfo, so nothing is copied
into the home trash. Every other case - a same-mount path, an option, or a
mount trash that cannot be found or created - runs the stock /usr/bin/trash-put
with the arguments unchanged and passes its exit code through.
"""


def _plan(path):
    """Return the rename of ``path`` into its mount trash, or None for the stock command.

    Args:
        path: A plain path argument

    Returns:
        The ``(src, dst, top)`` arguments of :func:`plat_other.trash_move`, or
        None when the path is on the mount of the home trash

    Raises:
        OSError: The mounts cannot be read or the mount trash cannot be found
            or created
    """
    path = op.normpath(path)
    src = op.join(op.realpath(op.dirname(path)), op.basename(path))
    mounts = _mounts()
    top = _mount_point(src, mounts)
    if top == _mount_point(_home_trash_dir(), mounts):
        return None
    top_b = os.fsencode(top)
    return os.fsencode(src), plat_other.find_ext_volume_trash(top_b), top_b


def _stock(args):
    """Run the stock command with ``args`` unchanged and return its exit code.

    Args:
        args: The command-line arguments of this script

    Returns:
        The exit code of ``/usr/bin/trash-put``, or 127 when it is not installed
    """
    try:
        return subprocess.run([STOCK, *args], check=False).returncode
    except FileNotFoundError:
        print(f"trash-put: {STOCK} not found", file=sys.stderr)
        return 127


def main(argv=None):
    """Run the trash-put command.

    Args:
        argv: The arguments to use; None reads ``sys.argv[1:]``

    Returns:
        The exit code: 0 when every path was renamed, the stock command's own
        exit code when it ran, 1 when a rename failed
    """
    args = list(sys.argv[1:] if argv is None else argv)
    if "--help" in args:
        print(USAGE, end="")
        return 0
    if (
        not args
        or any(
            not arg
            or arg.startswith("-")
            or not op.exists(arg)
            # The guard delegates the root and every dot spelling, including trailing slashes, to the stock command.
            or op.basename(arg.rstrip("/")) in ("", ".", "..")
            for arg in args
        )
    ):
        return _stock(args)
    try:
        moves = [_plan(arg) for arg in args]
    except OSError:
        return _stock(args)
    if any(move is None for move in moves):
        return _stock(args)
    for src, dst, top in moves:
        try:
            plat_other.trash_move(src, dst, top)
        except OSError as error:
            print(f"trash-put: {error}", file=sys.stderr)
            return 1
    return 0
