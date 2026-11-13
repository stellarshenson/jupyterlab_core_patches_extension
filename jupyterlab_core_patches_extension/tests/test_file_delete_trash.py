"""Server tests for the file delete to trash patch.

One test per acceptance criterion, ACC-PATCH-33 to ACC-PATCH-42. Mounts are
simulated with a stand-in for ``_mounts`` and an ``os.rename`` that fails with
EXDEV between the simulated mounts; one test uses real bind mounts under
bubblewrap. No test sends a request to a running lab: the HTTP test uses the
in-process pytest-jupyter server.
"""

import asyncio
import errno
import importlib
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from jupyter_server.services.contents import filemanager
from jupyter_server.services.contents.filemanager import AsyncFileContentsManager
from jupyter_server.services.contents.largefilemanager import AsyncLargeFileManager
from send2trash import plat_other
from send2trash.exceptions import TrashPermissionError
from tornado import web
from tornado.httpclient import HTTPClientError

import jupyterlab_core_patches_extension.server as server_package

MODULE = "jupyterlab_core_patches_extension.server.file_delete_trash"
EXT = importlib.import_module(MODULE)
PROJECT_ROOT = Path(__file__).parents[2]
UID = os.getuid()
APP = SimpleNamespace(log=logging.getLogger(__name__))

# conftest.py loads the extension into the test server, so the class can carry
# the wrapper already; the saved original is then the pristine method.
_PRISTINE = AsyncFileContentsManager.__dict__.get(
    EXT._ORIGINAL, AsyncFileContentsManager.delete_file
)

# Settings stand-in, read by the wrapper on every delete.
ENABLED = {EXT.SWITCH_KEY: True}


def _patch_enabled(server_app, key, default=True):
    """Return the switch value from ENABLED; unknown keys use default."""
    return ENABLED.get(key, default)


@pytest.fixture(autouse=True)
def _pristine_delete_file(monkeypatch):
    """Run every test against the pristine class, then put back the caller's."""
    monkeypatch.setattr(AsyncFileContentsManager, "delete_file", _PRISTINE)
    monkeypatch.delattr(AsyncFileContentsManager, EXT._ORIGINAL, raising=False)
    monkeypatch.setattr(EXT, "patch_enabled", _patch_enabled)
    monkeypatch.setitem(ENABLED, EXT.SWITCH_KEY, True)


@pytest.fixture
def layout(tmp_path, monkeypatch):
    """Two simulated mounts of one filesystem: home, which holds the home trash, and vol."""
    root = tmp_path.resolve()
    home, vol = root / "home", root / "vol"
    home.mkdir()
    vol.mkdir()
    share = home / ".local" / "share"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr(plat_other, "XDG_DATA_HOME", os.fsencode(share))
    monkeypatch.setattr(plat_other, "HOMETRASH_B", os.fsencode(share / "Trash"))
    monkeypatch.setattr(EXT, "_mounts", lambda: ["/", str(home), str(vol)])
    return SimpleNamespace(
        home=home,
        vol=vol,
        home_trash=share / "Trash",
        vol_trash=vol / f".Trash-{UID}",
    )


@pytest.fixture
def copies(layout, monkeypatch):
    """Make os.rename fail with EXDEV between the simulated mounts; record every shutil.move."""
    real_rename, real_move = os.rename, shutil.move
    moves = []

    def mount_of(path):
        path = os.fsdecode(path)
        return next(
            (m for m in (layout.home, layout.vol) if path.startswith(f"{m}/")), None
        )

    def rename(src, dst, *args, **kwargs):
        if mount_of(src) != mount_of(dst):
            raise OSError(errno.EXDEV, "Invalid cross-device link")
        return real_rename(src, dst, *args, **kwargs)

    def move(src, dst, *args, **kwargs):
        moves.append(src)
        return real_move(src, dst, *args, **kwargs)

    monkeypatch.setattr(os, "rename", rename)
    monkeypatch.setattr(shutil, "move", move)
    return moves


def _manager(root):
    return AsyncFileContentsManager(root_dir=str(root))


async def _largest_gap(coro):
    """Await ``coro`` while a 20 ms ticker runs; return the largest ticker gap."""
    gaps, done = [], False

    async def ticker():
        last = time.monotonic()
        while not done:
            await asyncio.sleep(0.02)
            now = time.monotonic()
            gaps.append(now - last)
            last = now

    task = asyncio.ensure_future(ticker())
    await asyncio.sleep(0.05)
    try:
        await coro
    finally:
        done = True
        await task
    return max(gaps)


def _trashinfo_path(trash, name):
    info = (trash / "info" / f"{name}.trashinfo").read_text(encoding="utf-8")
    return next(line for line in info.splitlines() if line.startswith("Path="))[5:]


@pytest.mark.parametrize("switch", [True, False], ids=["switch_on", "switch_off"])
async def test_delete_keeps_loop_responsive(tmp_path, monkeypatch, switch):
    """ACC-PATCH-33: the trash call runs in a worker thread; switch off shows the stock gap."""
    calls = []

    def slow_send2trash(path):
        time.sleep(1.0)
        calls.append(path)
        os.remove(path)

    monkeypatch.setattr(filemanager, "send2trash", slow_send2trash)
    monkeypatch.setattr(EXT, "_mounts", lambda: ["/"])
    monkeypatch.setitem(ENABLED, EXT.SWITCH_KEY, switch)
    EXT.patch_contents_manager(APP)
    (tmp_path / "big.bin").write_bytes(b"x")

    gap = await _largest_gap(_manager(tmp_path).delete_file("big.bin"))

    assert calls == [str(tmp_path / "big.bin")]
    if switch:
        assert gap < 0.5
    else:
        # the stock method blocks the loop for the whole call
        assert gap >= 0.9


async def test_concurrent_deletes_keep_every_item(layout, monkeypatch):
    """ACC-PATCH-42: two parallel deletes each keep their item in the trash; the loop runs."""
    real_check_create = plat_other.check_create

    def slow_check_create(path):
        # trash_move calls this after it picks a name and before it renames
        time.sleep(0.6)
        real_check_create(path)

    monkeypatch.setattr(plat_other, "check_create", slow_check_create)
    EXT.patch_contents_manager(APP)
    (layout.vol_trash / "files").mkdir(parents=True)
    (layout.vol_trash / "info").mkdir()
    (layout.vol_trash / "files" / "a.txt").write_text("old", encoding="utf-8")
    (layout.vol / "a.txt").write_text("A", encoding="utf-8")
    (layout.vol / "a 1.txt").write_text("B", encoding="utf-8")
    cm = _manager(layout.vol)

    gap = await _largest_gap(
        asyncio.gather(cm.delete_file("a.txt"), cm.delete_file("a 1.txt"))
    )

    files = layout.vol_trash / "files"
    assert sorted(f.read_text(encoding="utf-8") for f in files.iterdir()) == [
        "A",
        "B",
        "old",
    ]
    assert len(list((layout.vol_trash / "info").iterdir())) == 2
    assert gap < 0.5


async def test_cross_mount_delete_renames_into_mount_trash(layout, copies):
    """ACC-PATCH-34: a folder on another mount is renamed into that mount's trash."""
    EXT.patch_contents_manager(APP)
    target = layout.vol / "data"
    target.mkdir()
    (target / "a.bin").write_bytes(b"x" * 1024)
    inode = target.stat().st_ino

    await _manager(layout.vol).delete_file("data")

    trashed = layout.vol_trash / "files" / "data"
    assert trashed.stat().st_ino == inode
    assert (trashed / "a.bin").read_bytes() == b"x" * 1024
    assert not target.exists()
    assert copies == []
    assert not layout.home_trash.exists()
    assert _trashinfo_path(layout.vol_trash, "data") == "data"


def test_cross_mount_delete_reads_mount_points(tmp_path, monkeypatch):
    """ACC-PATCH-34: mountinfo escapes are decoded; the longest mount point prefix wins."""
    info = tmp_path / "mountinfo"
    info.write_bytes(
        b"1 0 8:1 / / rw - ext4 /dev/sda rw\n"
        b"2 1 8:48 /home /home rw - ext4 /dev/sdd rw\n"
        b"3 2 8:48 /work /home/lab/my\\040work rw - ext4 /dev/sdd rw\n"
    )
    monkeypatch.setattr(EXT, "open", lambda path, mode: open(info, mode), raising=False)

    mounts = EXT._mounts()

    assert mounts == ["/", "/home", "/home/lab/my work"]
    assert EXT._mount_point("/home/lab/my work/a.bin", mounts) == "/home/lab/my work"
    assert EXT._mount_point("/home/lab/my workshop/a.bin", mounts) == "/home"
    assert EXT._mount_point("/srv/a.bin", mounts) == "/"


def _bwrap_works():
    if shutil.which("bwrap") is None:
        return False
    probe = subprocess.run(
        ["bwrap", "--dev-bind", "/", "/", "true"], capture_output=True, check=False
    )
    return probe.returncode == 0


@pytest.mark.skipif(
    not _bwrap_works(), reason="bwrap or unprivileged user namespaces are missing"
)
def test_cross_mount_delete_on_real_bind_mounts(tmp_path):
    """ACC-PATCH-34: two bind mounts of one filesystem; the delete is a rename, not a copy."""
    src_home, src_vol, ns_home, ns_vol = (
        tmp_path / name for name in ("src_home", "src_vol", "ns_home", "ns_vol")
    )
    for folder in (src_home, src_vol, ns_home, ns_vol):
        folder.mkdir()
    (src_vol / "big.bin").write_bytes(b"\0" * (1 << 20))
    inode = (src_vol / "big.bin").stat().st_ino
    script = f"import sys\nfrom {MODULE} import _trash\n_trash(sys.argv[1])\n"

    subprocess.run(
        [
            "bwrap", "--dev-bind", "/", "/",
            "--bind", str(src_home), str(ns_home),
            "--bind", str(src_vol), str(ns_vol),
            "--setenv", "HOME", str(ns_home),
            "--unsetenv", "XDG_DATA_HOME",
            "--die-with-parent",
            "--", sys.executable, "-c", script, str(ns_vol / "big.bin"),
        ],
        cwd=PROJECT_ROOT,
        check=True,
        timeout=60,
    )

    trash = src_vol / f".Trash-{UID}"
    assert (trash / "files" / "big.bin").stat().st_ino == inode
    assert not (src_vol / "big.bin").exists()
    assert not (src_home / ".local").exists()
    assert _trashinfo_path(trash, "big.bin") == "big.bin"


async def test_symlinked_parent_trashinfo_has_no_dotdot(layout):
    """ACC-PATCH-35: a path through a symlinked parent records the path under its mount."""
    EXT.patch_contents_manager(APP)
    (layout.vol / "cache").mkdir()
    (layout.vol / "cache" / "model.bin").write_bytes(b"x")
    (layout.home / "cache").symlink_to(layout.vol / "cache")

    await _manager(layout.home).delete_file("cache/model.bin")

    assert (layout.vol_trash / "files" / "model.bin").is_file()
    path = _trashinfo_path(layout.vol_trash, "model.bin")
    assert path == "cache/model.bin"
    assert ".." not in path


@pytest.mark.parametrize("failure", ["mount_root_not_writable", "proc_unreadable"])
async def test_falls_back_to_stock_trash(layout, monkeypatch, failure):
    """ACC-PATCH-36: an unusable mount trash sends the item through the stock send2trash."""
    if failure == "mount_root_not_writable":

        def refuse(volume_root):
            raise TrashPermissionError(os.fsdecode(volume_root))

        monkeypatch.setattr(plat_other, "find_ext_volume_trash", refuse)
    else:

        def unreadable():
            raise FileNotFoundError(errno.ENOENT, "No such file", "/proc/self/mountinfo")

        monkeypatch.setattr(EXT, "_mounts", unreadable)
    EXT.patch_contents_manager(APP)
    (layout.vol / "notes.txt").write_text("x", encoding="utf-8")

    await _manager(layout.vol).delete_file("notes.txt")

    assert (layout.home_trash / "files" / "notes.txt").is_file()
    assert not (layout.vol / "notes.txt").exists()
    assert not layout.vol_trash.exists()


async def test_failed_rename_never_falls_back_to_stock_trash(layout, copies, monkeypatch):
    """ACC-PATCH-36: a rename into the mount trash that raises EACCES answers 400; nothing is copied."""
    cross_mount_rename = os.rename

    def rename(src, dst, *args, **kwargs):
        if os.fsdecode(dst).startswith(f"{layout.vol_trash}/"):
            raise PermissionError(errno.EACCES, "Permission denied")
        return cross_mount_rename(src, dst, *args, **kwargs)

    monkeypatch.setattr(os, "rename", rename)
    EXT.patch_contents_manager(APP)
    (layout.vol / "notes.txt").write_text("x", encoding="utf-8")

    with pytest.raises(web.HTTPError) as failed:
        await _manager(layout.vol).delete_file("notes.txt")

    assert failed.value.status_code == 400
    assert failed.value.log_message.startswith("send2trash failed:")
    assert (layout.vol / "notes.txt").is_file()
    assert copies == []
    assert not layout.home_trash.exists()


async def test_stock_error_answers_kept(jp_fetch, jp_root_dir, jp_serverapp, monkeypatch):
    """ACC-PATCH-37: DELETE answers 400 hidden, 404 missing, 403 not writable, 400 failed, 204."""
    # the in-process server loaded the extension, so its contents manager runs the wrapper
    assert AsyncFileContentsManager.delete_file.__wrapped__ is _PRISTINE
    assert isinstance(jp_serverapp.contents_manager, AsyncFileContentsManager)

    def send2trash(path):
        if path.endswith("broken.txt"):
            raise OSError(errno.EIO, "Input/output error")
        os.remove(path)

    monkeypatch.setattr(EXT, "_mounts", lambda: ["/"])
    monkeypatch.setattr(filemanager, "send2trash", send2trash)
    monkeypatch.setattr(
        AsyncFileContentsManager,
        "is_writable",
        lambda self, path: not path.endswith("locked.txt"),
    )
    for name in (".hidden.txt", "locked.txt", "broken.txt", "kept.txt"):
        (jp_root_dir / name).write_text("x", encoding="utf-8")

    async def answer(name):
        try:
            response = await jp_fetch("api", "contents", name, method="DELETE")
        except HTTPClientError as error:
            return error.code, json.loads(error.response.body)["message"]
        return response.code, ""

    assert (await answer(".hidden.txt"))[0] == 400
    assert (await answer("missing.txt"))[0] == 404
    assert (await answer("locked.txt"))[0] == 403
    code, message = await answer("broken.txt")
    assert code == 400
    assert message.startswith("send2trash failed:")
    assert await answer("kept.txt") == (204, "")
    assert not (jp_root_dir / "kept.txt").exists()

    # the HTTP handler answers a hidden path before delete_file; the wrapper keeps its own check
    with pytest.raises(web.HTTPError) as hidden:
        await jp_serverapp.contents_manager.delete_file(".hidden.txt")
    assert hidden.value.status_code == 400


@pytest.mark.parametrize("case", ["switch_off", "delete_to_trash_false", "not_linux"])
async def test_switch_off_calls_original(tmp_path, monkeypatch, case):
    """ACC-PATCH-38: the original runs unchanged while the case holds; the next delete after is patched."""
    calls, trashed = [], []

    async def original(self, path):
        calls.append(path)

    monkeypatch.setattr(AsyncFileContentsManager, "delete_file", original)
    monkeypatch.setattr(EXT, "_trash", trashed.append)
    EXT.patch_contents_manager(APP)
    (tmp_path / "a.txt").write_text("x", encoding="utf-8")
    cm = _manager(tmp_path)

    def hold(holds):
        if case == "switch_off":
            monkeypatch.setitem(ENABLED, EXT.SWITCH_KEY, not holds)
        elif case == "delete_to_trash_false":
            cm.delete_to_trash = not holds
        else:
            monkeypatch.setattr(sys, "platform", "darwin" if holds else "linux")

    hold(True)
    await cm.delete_file("/a.txt")
    assert calls == ["/a.txt"]
    assert trashed == []

    hold(False)
    await cm.delete_file("/a.txt")
    assert calls == ["/a.txt"]
    assert trashed == [str(tmp_path / "a.txt")]


def test_does_not_wrap_twice(monkeypatch):
    """ACC-PATCH-39: a second call keeps one wrapper level; a re-imported module replaces it."""
    EXT.patch_contents_manager(APP)
    EXT.patch_contents_manager(APP)
    wrapper = AsyncFileContentsManager.delete_file
    assert wrapper.__wrapped__ is _PRISTINE
    assert AsyncLargeFileManager.delete_file is wrapper

    # a soft reload purges the module and imports it again
    monkeypatch.delitem(sys.modules, MODULE)
    monkeypatch.setattr(server_package, "file_delete_trash", EXT)
    fresh = importlib.import_module(MODULE)
    assert fresh is not EXT
    fresh.patch_contents_manager(APP)

    reloaded = AsyncFileContentsManager.delete_file
    assert reloaded.__wrapped__ is _PRISTINE
    assert reloaded.__globals__ is fresh.__dict__
