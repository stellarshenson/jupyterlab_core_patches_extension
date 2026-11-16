"""Tests of the shell names and /proc readers shared by the two terminal patches."""

import importlib
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

PROCESSES = importlib.import_module(
    "jupyterlab_core_patches_extension.server.terminal_processes"
)
CPR_ESCAPE = importlib.import_module(
    "jupyterlab_core_patches_extension.server.terminal_cpr_escape"
)
RESTORE = importlib.import_module(
    "jupyterlab_core_patches_extension.server.restore_terminals"
)

SERVER_DIR = Path(PROCESSES.__file__).parent

linux_only = pytest.mark.skipif(sys.platform != "linux", reason="reads /proc")


def test_both_modules_use_the_one_shell_set():
    """ACC-PATCH-53: restore terminals uses the shared set; the CPR escape bytes set is built from it."""
    assert RESTORE.SHELL_NAMES is PROCESSES.SHELL_NAMES
    assert CPR_ESCAPE._SHELLS == {name.encode() for name in PROCESSES.SHELL_NAMES}
    assert PROCESSES.SHELL_NAMES == {
        "bash", "sh", "dash", "zsh", "fish", "ksh", "tcsh", "csh"
    }


def test_one_shell_list_definition_under_server():
    """ACC-PATCH-53: a shell name literal appears in one server module only."""
    defining = [
        path.name
        for path in sorted(SERVER_DIR.glob("*.py"))
        if re.search(r"""["']zsh["']""", path.read_text(encoding="utf-8"))
    ]

    assert defining == ["terminal_processes.py"]


def test_both_modules_read_proc_through_the_helper():
    """ACC-PATCH-53: both server modules call the shared /proc readers."""
    for module in (CPR_ESCAPE, RESTORE):
        assert module.read_comm is PROCESSES.read_comm
        assert module.read_children is PROCESSES.read_children


@linux_only
def test_readers_return_the_name_and_children_of_a_live_process():
    """read_comm returns the comm bytes; read_children lists a child the leader thread forked."""
    child = subprocess.Popen(["sleep", "60"])
    try:
        assert PROCESSES.read_comm(child.pid) == b"sleep\n"
        pid = os.getpid()
        # Popen forks from the calling thread, the main thread, whose id is the pid
        assert str(child.pid).encode() in PROCESSES.read_children(pid, pid)
        assert RESTORE._get_process_comm(child.pid) == "sleep"
        assert child.pid in RESTORE._get_direct_children(pid)
    finally:
        child.kill()
        child.wait()


@linux_only
def test_readers_raise_oserror_for_an_exited_process():
    """Both readers raise OSError once the process has exited."""
    gone = subprocess.Popen(["true"])
    gone.wait()

    with pytest.raises(OSError):
        PROCESSES.read_comm(gone.pid)
    with pytest.raises(OSError):
        PROCESSES.read_children(gone.pid, gone.pid)
