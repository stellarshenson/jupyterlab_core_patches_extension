"""Shell names and /proc readers shared by the two terminal patches.

The terminal CPR escape patch reads the foreground process group of a PTY to
tell a shell at its prompt from a running program. The restore terminals patch
walks the process tree under a PTY to find the folder of its shell. Both know
the same shells and read the same two /proc files; each module keeps its own
comparison and its own error handling.
"""

# The process names of the shells a terminal runs, as /proc/<pid>/comm holds
# them without the newline.
SHELL_NAMES = frozenset(
    {"bash", "sh", "dash", "zsh", "fish", "ksh", "tcsh", "csh"}
)


def read_comm(pid) -> bytes:
    """Return the bytes of ``/proc/<pid>/comm``: the process name and a newline.

    Args:
        pid: The process id

    Returns:
        The file content, unchanged

    Raises:
        OSError: The file cannot be read, for example after the process exited
    """
    with open(f"/proc/{pid}/comm", "rb") as comm:
        return comm.read()


def read_children(pid, tid) -> list[bytes]:
    """Return the child process ids that thread ``tid`` of process ``pid`` forked.

    Reads ``/proc/<pid>/task/<tid>/children``. The file of one thread lists
    only the children that thread forked; the leader thread has ``tid == pid``.

    Args:
        pid: The process id
        tid: The thread id

    Returns:
        Each child process id as the bytes of a decimal number

    Raises:
        OSError: The file cannot be read, for example on a kernel without it
    """
    with open(f"/proc/{pid}/task/{tid}/children", "rb") as children:
        return children.read().split()
