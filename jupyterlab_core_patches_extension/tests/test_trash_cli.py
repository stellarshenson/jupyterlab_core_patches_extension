"""Tests for the trash-put console script, ACC-PATCH-56 to ACC-PATCH-60.

Mounts are simulated with a stand-in for the mount reader; one test uses real
bind mounts under bubblewrap. The stock command is recorded by patching
``subprocess.run``, so no test runs ``/usr/bin/trash-put`` or touches the home
trash.
"""

import errno
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote

import pytest
from send2trash import plat_other

from jupyterlab_core_patches_extension.cli import trash_put

PROJECT_ROOT = Path(__file__).parents[2]
UID = os.getuid()
SKILL = (
    PROJECT_ROOT
    / ".agents"
    / "skills"
    / "jupyterlab-core-patches-extension"
    / "SKILL.md"
)


def _pyproject():
    return tomllib.loads((PROJECT_ROOT / "pyproject.toml").read_text(encoding="utf-8"))


@pytest.fixture
def mounts(tmp_path, monkeypatch):
    """Two simulated mounts of one filesystem: home, which holds the home trash, and vol."""
    root = tmp_path.resolve()
    home, vol = root / "home", root / "vol"
    home.mkdir()
    vol.mkdir()
    share = home / ".local" / "share"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setattr(plat_other, "XDG_DATA_HOME", os.fsencode(share))
    monkeypatch.setattr(plat_other, "HOMETRASH_B", os.fsencode(share / "Trash"))
    monkeypatch.setattr(trash_put, "_mounts", lambda: ["/", str(home), str(vol)])
    return SimpleNamespace(
        home=home,
        vol=vol,
        home_trash=share / "Trash",
        vol_trash=vol / f".Trash-{UID}",
    )


@pytest.fixture
def stock(monkeypatch):
    """Record every run of the stock command and answer exit code 5."""
    calls = []

    def run(argv, *args, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=5)

    monkeypatch.setattr(trash_put.subprocess, "run", run)
    return calls


def _trashinfo_path(trash, name):
    info = (trash / "info" / f"{name}.trashinfo").read_text(encoding="utf-8")
    line = next(line for line in info.splitlines() if line.startswith("Path="))
    return unquote(line[5:])


def test_entry_point_registered():
    """ACC-PATCH-56: pyproject registers the trash-put console script."""
    assert (
        _pyproject()["project"]["scripts"]["trash-put"]
        == "jupyterlab_core_patches_extension.cli.trash_put:main"
    )


def test_help_names_cross_mount_and_stock_fallback(capsys):
    """ACC-PATCH-56: --help exits 0 and states the cross-mount move and the fallback."""
    assert trash_put.main(["--help"]) == 0
    out = capsys.readouterr().out
    assert "cross-mount" in out
    assert "<mount>/.Trash-<uid>" in out
    assert "/usr/bin/trash-put" in out


def test_installed_script_resolves_before_stock(tmp_path, monkeypatch):
    """ACC-PATCH-56: a console script in a bin folder ahead of /usr/bin wins on PATH."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "trash-put"
    script.write_text(
        f"#!{sys.executable}\n"
        "import sys\n"
        "from jupyterlab_core_patches_extension.cli.trash_put import main\n"
        "sys.exit(main())\n",
        encoding="utf-8",
    )
    script.chmod(0o755)
    monkeypatch.setenv("PATH", os.pathsep.join([str(bin_dir), "/usr/bin"]))
    # The console script imports the package the way an install puts it on sys.path.
    monkeypatch.setenv("PYTHONPATH", str(PROJECT_ROOT))

    assert shutil.which("trash-put") == str(script)
    help_run = subprocess.run(
        [str(script), "--help"], capture_output=True, text=True, check=False
    )
    assert help_run.returncode == 0
    assert "cross-mount" in help_run.stdout


def test_cross_mount_path_is_a_rename(mounts):
    """ACC-PATCH-57: the move keeps the inode and adds nothing to the home trash."""
    src = mounts.vol / "big.bin"
    src.write_bytes(b"x" * 1024)
    inode = src.stat().st_ino

    assert trash_put.main([str(src)]) == 0

    moved = mounts.vol_trash / "files" / "big.bin"
    assert moved.stat().st_ino == inode
    assert not src.exists()
    assert not mounts.home_trash.exists()
    assert _trashinfo_path(mounts.vol_trash, "big.bin") == "big.bin"


def test_nested_path_records_relative_trashinfo_path(mounts):
    """ACC-PATCH-57: the .trashinfo Path is relative to the mount root."""
    (mounts.vol / "cache").mkdir()
    src = mounts.vol / "cache" / "model.bin"
    src.write_bytes(b"x")

    assert trash_put.main([str(src)]) == 0

    assert _trashinfo_path(mounts.vol_trash, "model.bin") == "cache/model.bin"


def test_failed_rename_leaves_item_and_exits_1(mounts, monkeypatch, capsys):
    """ACC-PATCH-57: a failed rename leaves the item in place and exits 1."""
    src = mounts.vol / "big.bin"
    src.write_bytes(b"x")

    def fail(*args):
        raise OSError("rename failed")

    monkeypatch.setattr(trash_put.plat_other, "trash_move", fail)

    assert trash_put.main([str(src)]) == 1

    assert src.exists()
    assert "rename failed" in capsys.readouterr().err


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
def test_cross_mount_path_on_real_bind_mounts(tmp_path):
    """ACC-PATCH-57: on real bind mounts of one disk the CLI renames rather than copies."""
    src_home, src_vol, ns_home, ns_vol = (
        tmp_path / name for name in ("src_home", "src_vol", "ns_home", "ns_vol")
    )
    for folder in (src_home, src_vol, ns_home, ns_vol):
        folder.mkdir()
    (src_vol / "big.bin").write_bytes(b"\0" * (1 << 20))
    inode = (src_vol / "big.bin").stat().st_ino
    script = (
        "import sys\n"
        "from jupyterlab_core_patches_extension.cli.trash_put import main\n"
        "sys.exit(main([sys.argv[1]]))\n"
    )

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


def test_same_mount_path_goes_to_stock(mounts, stock):
    """ACC-PATCH-58: a same-mount path is passed to the stock command unchanged."""
    src = mounts.home / "small.txt"
    src.write_text("x", encoding="utf-8")

    assert trash_put.main([str(src)]) == 5

    assert stock == [["/usr/bin/trash-put", str(src)]]
    assert src.exists()
    assert not mounts.home_trash.exists()


@pytest.mark.parametrize("option", ["--version", "-v"])
def test_option_goes_to_stock(stock, option):
    """ACC-PATCH-58: an argument that starts with a hyphen is passed unchanged."""
    assert trash_put.main([option]) == 5

    assert stock == [["/usr/bin/trash-put", option]]


def test_no_arguments_go_to_stock(stock):
    """ACC-PATCH-58: no arguments forwards to the stock command."""
    assert trash_put.main([]) == 5

    assert stock == [["/usr/bin/trash-put"]]


def test_missing_path_goes_to_stock(mounts, stock):
    """ACC-PATCH-58: a path that does not exist is left to the stock command."""
    missing = str(mounts.vol / "missing.txt")

    assert trash_put.main([missing]) == 5

    assert stock == [["/usr/bin/trash-put", missing]]


@pytest.mark.parametrize(
    "arg", [".", "..", "./", "../", "sub/.", "sub/..", "sub/../", "/"]
)
def test_dot_spellings_and_root_go_to_stock(mounts, stock, monkeypatch, arg):
    """ACC-PATCH-58: the root and every dot spelling on a cross-mount folder go to stock."""
    sub = mounts.vol / "sub"
    sub.mkdir()
    monkeypatch.chdir(mounts.vol)

    assert trash_put.main([arg]) == 5

    assert stock == [["/usr/bin/trash-put", arg]]
    assert not list(mounts.vol_trash.glob("info/*.trashinfo"))
    assert mounts.vol.exists()
    assert sub.exists()


def test_mixed_mount_list_goes_to_stock_unchanged(mounts, stock):
    """ACC-PATCH-58: a list that holds a same-mount path is forwarded whole."""
    home_file = mounts.home / "a.txt"
    vol_file = mounts.vol / "b.txt"
    home_file.write_text("x", encoding="utf-8")
    vol_file.write_text("x", encoding="utf-8")

    assert trash_put.main([str(home_file), str(vol_file)]) == 5

    assert stock == [["/usr/bin/trash-put", str(home_file), str(vol_file)]]
    assert vol_file.exists()


@pytest.mark.parametrize("failure", ["mount_root_not_writable", "proc_unreadable"])
def test_unusable_mount_trash_goes_to_stock(mounts, stock, monkeypatch, failure):
    """ACC-PATCH-58: an unusable mount trash passes the whole argument list to stock."""
    if failure == "mount_root_not_writable" and os.getuid() == 0:
        pytest.skip("root writes to a folder with mode 0500")
    src = mounts.vol / "big.bin"
    src.write_bytes(b"x")
    if failure == "mount_root_not_writable":
        mounts.vol.chmod(0o500)
    else:

        def unreadable():
            raise OSError(errno.ENOENT, "No such file", "/proc/self/mountinfo")

        monkeypatch.setattr(trash_put, "_mounts", unreadable)
    try:
        assert trash_put.main([str(src)]) == 5
    finally:
        if failure == "mount_root_not_writable":
            mounts.vol.chmod(0o700)

    assert stock == [["/usr/bin/trash-put", str(src)]]
    assert src.exists()
    assert not (mounts.vol / f".Trash-{UID}").exists()


def test_skill_file_documents_the_cli():
    """ACC-PATCH-59: the agent skill ships at the project path and names the CLI."""
    text = SKILL.read_text(encoding="utf-8")

    assert text.startswith("---\nname: jupyterlab-core-patches-extension\n")
    assert "description:" in text
    assert "trash-put" in text
    assert "cross-mount" in text.lower()


def test_shared_data_ships_the_skill():
    """ACC-PATCH-59: the wheel shared-data carries the skill folder."""
    shared = _pyproject()["tool"]["hatch"]["build"]["targets"]["wheel"]["shared-data"]

    assert (
        shared[".agents/skills/jupyterlab-core-patches-extension"]
        == "share/jupyter/agents/skills/jupyterlab-core-patches-extension"
    )


def test_docs_page_names_the_cli():
    """ACC-PATCH-60: the page names the CLI, the PATH precedence and the fallback."""
    page = (PROJECT_ROOT / "docs" / "file-delete-trash.md").read_text(encoding="utf-8")

    assert "`trash-put`" in page
    assert "precedes `/usr/bin`" in page
    assert "/usr/bin/trash-put" in page
    assert "**Fallback**" in page


def test_readme_mentions_the_cli():
    """ACC-PATCH-60: the README names the CLI in the patch row."""
    readme = (PROJECT_ROOT / "README.md").read_text(encoding="utf-8")

    assert "`trash-put` command" in readme
    assert "docs/file-delete-trash.md" in readme
