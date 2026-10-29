"""Server half of the terminal CPR escape patch.

Filters terminal query responses that appear as literal text when reconnecting
to idle terminals, strips terminal queries and clears the client before a
buffer replay, and repaints a full-screen program after a client attaches. The
frontend half holds back the size of an unopened xterm and redraws a background
terminal at its real size when its tab is first shown.

The source project is ``jupyterlab_terminal_cpr_escape_fix``; the patch logic is
ported unchanged. The switch gate, the settings source and the import paths are
the only changes.
"""

import logging
import os
import re
import time
from collections import Counter

from jupyterlab_core_patches_extension.settings import patch_enabled

# The switch key in the shared settings schema. The frontend plugin gates on
# the same key, so one switch turns off both halves of the patch.
SWITCH_KEY = "jupyterlab_terminal_cpr_escape_fix"

# The option that gates the repaint step after a client attaches.
REDRAW_OPTION = "redrawBackgroundTerminals"

# Internal defaults of the source package. Only repaint_on_attach is a setting
# in the combined extension, read as REDRAW_OPTION on each attach. The other
# four stay fixed: the package exposes no switch for them.
DEFAULTS = {
    "suppress_buffer_replay": False,
    "filter_osc_color_responses": True,
    "strip_replay_queries": True,
    "clear_before_replay": True,
}

# Set on TermSocket once the wrappers are in place, so a second
# patch_term_socket call changes nothing.
_PATCH_MARKER = "_jp_terminal_cpr_escape_patched"

logger = logging.getLogger(__name__)

# Patterns WITH the ESC prefix: terminal RESPONSE sequences. Queries are not
# matched; stripping a query breaks terminal capability negotiation.
# CPR response: ESC[row;colR (two numeric params)
# DA response: ESC[?p1;p2;...c (params after ?)
# DA2 response: ESC[>p1;p2;p3c (semicolon-separated params; bare ESC[>c is a
#               query)
# DECRPM: ESC[?mode;value$y
# OSC: every ESC]N;... and ESC]4;n;... payload (N = 10, 11, 12) not starting
#      with ?, so colour set commands (ESC]11;#282828 BEL) are removed as well
#      as responses; the queries ESC]N;? and ESC]4;n;? are kept
ESC_CPR = re.compile(r"\x1b\[\d+;\d+R")
ESC_DA = re.compile(r"\x1b\[\?\d+[\d;]*c")
ESC_DA2 = re.compile(r"\x1b\[>\d+;\d+[\d;]*c")
ESC_DECRPM = re.compile(r"\x1b\[\??\d+;\d+\$y")
ESC_OSC = re.compile(r"\x1b\](?:4;\d+|10|11|12);(?!\?)[^\x07\x1b]*(?:\x07|\x1b\\)")

# Patterns WITHOUT the ESC prefix: bare remnants after a shell strips ESC.
# Fish receives ESC[row;colR, strips ESC and outputs [row;colR. The negative
# lookbehind keeps an ESC-prefixed sequence from matching twice.
BARE_CPR = re.compile(r"(?<!\x1b)\[\d+;\d+R")
BARE_DA = re.compile(r"(?<!\x1b)\[\?\d+[\d;]*c")
BARE_DA2 = re.compile(r"(?<!\x1b)\[>\d+;\d+[\d;]*c")
BARE_DECRPM = re.compile(r"(?<!\x1b)\[\??\d+;\d+\$y")
# A bare OSC colour response: fish strips ESC from both the ] introducer and
# the ST terminator, so ESC]11;rgb:..ST becomes ]11;rgb:..\ as literal text.
# Anchored on rgb: to keep the false-positive surface near zero.
BARE_OSC = re.compile(r"(?<!\x1b)\](?:4|10|11|12);(?:\d+;)?rgb:[0-9a-fA-F/]+(?:\x07|\\)")

# All filter patterns: ESC-prefixed first, then bare remnants.
FILTER_PATTERNS = [
    ("cpr", ESC_CPR),
    ("da", ESC_DA),
    ("da2", ESC_DA2),
    ("decrpm", ESC_DECRPM),
    ("osc", ESC_OSC),
    ("bare_cpr", BARE_CPR),
    ("bare_da", BARE_DA),
    ("bare_da2", BARE_DA2),
    ("bare_decrpm", BARE_DECRPM),
    ("bare_osc", BARE_OSC),
]

# Terminal QUERY sequences that xterm.js answers. Applied only to the buffer
# replay of TermSocket.open, never to live output: the client parses the replay
# as live output and answers every query in it, and the shell reads those
# answers as typed text.
# OSC colour: ESC]4;n;?  ESC]10;?  ESC]11;?  ESC]12;?  (BEL or ST), and the
#             chained forms ESC]4;n;?;m;?  ESC]10;?;?
# DA / DA2:   ESC[c  ESC[0c  ESC[>c  ESC[>0c
# DSR / CPR:  ESC[5n  ESC[6n  ESC[?6n
# DECRQM:     ESC[?mode$p  ESC[mode$p
# DECRQSS:    ESC P $q text ST
REPLAY_QUERY = re.compile(
    r"\x1b\](?:4(?:;\d+;\?)+|(?:10|11|12)(?:;\?)+)(?:\x07|\x1b\\)"
    r"|\x1b\[>?0?c"
    r"|\x1b\[(?:5|6|\?6)n"
    r"|\x1b\[\??\d+\$p"
    r"|\x1bP\$q[^\x1b]*\x1b\\"
)

# Alternate-screen modes that decide which screen a replay starts on.
_PRIVATE_MODE = re.compile(r"\x1b\[\?([\d;]*)([hl])")
_ALTERNATE_SCREEN_MODES = {"47", "1047", "1049"}

# Cursor home, erase screen, erase scrollback. No full reset (ESC c) and no soft
# reset (ESC [ ! p): both reset input modes (bracketed paste, mouse reporting,
# cursor keys) that must survive a plain reconnect.
_CLEAR = "\x1b[H\x1b[2J\x1b[3J"
_LEAVE_ALTERNATE = "\x1b[?1049l"
_ENTER_ALTERNATE = "\x1b[?1049h"

# Repaint on attach: after a client attaches and the buffer replay drains, set
# the PTY one column narrower and back so the kernel delivers SIGWINCH and the
# foreground app repaints its full screen. A column step, not a row step: a
# program that addresses rows absolutely takes a taller PTY as truth and loses
# the line it commits during the step. One column narrower, not wider: a
# program that writes to the last column wraps when the PTY is wider. No step
# while the foreground process group is one shell alone (a shell at its
# prompt); a shell with a child in its own process group runs a program
# without job control and is stepped.
_BOUNCE_DELAY = 0.4  # let client geometry settle before the step
_BOUNCE_STEP = 0.12  # pause between the narrow write and the restore
_BOUNCE_DEBOUNCE = 5.0  # min seconds between steps on the same terminal
_SHELLS = frozenset(
    {b"bash", b"sh", b"dash", b"zsh", b"fish", b"ksh", b"tcsh", b"csh"}
)


def filter_terminal_responses(text: str) -> tuple[str, dict[str, int], list[str]]:
    """Filter terminal query responses from output.

    Handles both ESC-prefixed sequences and bare remnants where the shell has
    stripped the ESC byte.

    Args:
        text: The terminal output to filter

    Returns:
        The filtered text, the count per pattern name, and the matched strings
    """
    counts = {}
    matched = []
    result = text

    for name, pattern in FILTER_PATTERNS:
        matches = pattern.findall(result)
        counts[name] = len(matches)
        if matches:
            matched.extend(matches)
            result = pattern.sub("", result)

    return result, counts, matched


def strip_replay_queries(text: str) -> str:
    """Remove terminal queries from a buffer replay.

    A run of queries that ends the text is kept: nothing was printed after it,
    so the program that sent it may still be waiting for the answer.

    Args:
        text: The buffered terminal output that TermSocket.open replays

    Returns:
        The text with every query removed except a run that ends it
    """
    keep_from = len(text)
    for match in reversed(list(REPLAY_QUERY.finditer(text))):
        if match.end() != keep_from:
            break
        keep_from = match.start()
    return REPLAY_QUERY.sub("", text[:keep_from]) + text[keep_from:]


def _first_alternate_screen_switch(text: str) -> str | None:
    """Return ``"h"`` or ``"l"`` for the first alternate-screen switch.

    Args:
        text: The replay text

    Returns:
        The mode character of the first switch, or ``None`` when there is none
    """
    for match in _PRIVATE_MODE.finditer(text):
        if _ALTERNATE_SCREEN_MODES.intersection(match.group(1).split(";")):
            return match.group(2)
    return None


def clear_before_replay(text: str) -> str:
    """Put the sequences that empty the client's terminal in front of a replay.

    Which screen the replay starts on decides the prefix:

    - no alternate-screen switch in the replay: the screen the client shows now
      is kept, because the whole replay belongs to it
    - the first switch is an entry: the replay starts on the normal screen, so
      the prefix leaves the alternate screen first
    - the first switch is a leave: the replay starts inside the alternate
      screen, so the prefix enters it again after the clear

    Args:
        text: The buffered terminal output that TermSocket.open replays

    Returns:
        The prefix followed by text, which is unchanged
    """
    switch = _first_alternate_screen_switch(text)
    if switch is None:
        return _CLEAR + text
    if switch == "h":
        return _LEAVE_ALTERNATE + _CLEAR + text
    return _LEAVE_ALTERNATE + _CLEAR + _ENTER_ALTERNATE + text


def _shell_at_prompt(term) -> bool:
    """Return True when the foreground process group of the PTY is one shell.

    The leader is a shell when the bytes of ``/proc/<leader>/comm`` are in
    ``_SHELLS``; it is alone when no child in
    ``/proc/<leader>/task/<leader>/children`` has the leader's process group.
    False for a shell with a child in its own group: it runs a program without
    job control, and that program needs the repaint. A child in another group
    (a background job) does not count. False when the state cannot be read: a
    terminal without ``fd``, no ``/proc``, no children file, a process that
    exited.
    """
    try:
        leader = os.tcgetpgrp(term.fd)
        with open(f"/proc/{leader}/comm", "rb") as comm:
            if comm.read().strip() not in _SHELLS:
                return False
        with open(f"/proc/{leader}/task/{leader}/children", "rb") as children:
            return all(
                os.getpgid(int(pid)) != leader for pid in children.read().split()
            )
    except (AttributeError, OSError):
        return False


def _make_winsize_bounce(term, schedule):
    """Return a function that sets a PTY one column narrower and back.

    Each size change makes the kernel send SIGWINCH to the foreground process
    group, which makes TUI apps repaint their full screen. The restore write is
    guarded: it only runs if the size is still the stepped one, so a real
    client resize racing the step is never clobbered. ``schedule(delay, fn)``
    abstracts the IOLoop so the logic stays testable. The function does nothing
    while the foreground process group is one shell alone.

    Known limitation: a client resize to exactly ``cols - 1`` within the step
    window is taken for the step and reverted, so the PTY is one column wider
    than that client until the next resize event.
    """

    def bounce():
        if _shell_at_prompt(term):
            return
        try:
            rows, cols = term.getwinsize()
            term.setwinsize(rows, cols - 1)
        except Exception:
            return

        def restore():
            try:
                if term.getwinsize() == (rows, cols - 1):
                    term.setwinsize(rows, cols)
            except Exception:
                pass

        schedule(_BOUNCE_STEP, restore)

    return bounce


def patch_term_socket(server_app):
    """Patch ``TermSocket`` for the terminal CPR fix.

    Installs the response filter on ``TermSocket.on_pty_read`` and the replay
    and repaint steps on ``TermSocket.open``. Both wrappers read the switch
    through :func:`patch_enabled` on every call and fall through to the
    original handler when the switch is off. The repaint step additionally
    reads ``redrawBackgroundTerminals`` on every attach. A second call for the
    same class returns before it wraps a second time.

    Args:
        server_app: The JupyterLab application passed to the server extension
    """
    try:
        from jupyter_server_terminals.handlers import TermSocket
    except ImportError:
        server_app.log.warning(
            "jupyterlab_terminal_cpr_escape_fix: jupyter_server_terminals not found"
        )
        return

    if getattr(TermSocket, _PATCH_MARKER, False):
        return
    setattr(TermSocket, _PATCH_MARKER, True)

    # bare_osc is in FILTER_PATTERNS by default; drop it when the toggle is off
    # so the bare OSC colour-response filter can be disabled without a code
    # change.
    if not DEFAULTS["filter_osc_color_responses"]:
        FILTER_PATTERNS[:] = [p for p in FILTER_PATTERNS if p[0] != "bare_osc"]

    _original_on_pty_read = TermSocket.on_pty_read
    _LOG_INTERVAL = 60  # seconds
    _accum = {"counts": Counter(), "matched": [], "last_flush": time.monotonic()}

    def _flush_log():
        if _accum["counts"]:
            active = {k: v for k, v in _accum["counts"].items() if v > 0}
            unique = sorted(set(_accum["matched"]))
            logger.info(
                "CPR filter: FILTERED %d sequences in last %ds: %s | %r",
                sum(_accum["counts"].values()),
                _LOG_INTERVAL,
                ", ".join(f"{v} {k}" for k, v in active.items()),
                unique,
            )
        _accum["counts"] = Counter()
        _accum["matched"] = []
        _accum["last_flush"] = time.monotonic()

    def _filtered_on_pty_read(self, text):
        if not patch_enabled(server_app, SWITCH_KEY):
            _original_on_pty_read(self, text)
            return
        filtered, counts, matched = filter_terminal_responses(text)
        total = sum(counts.values())
        if total > 0:
            _accum["counts"].update({k: v for k, v in counts.items() if v > 0})
            _accum["matched"].extend(matched)
        if time.monotonic() - _accum["last_flush"] >= _LOG_INTERVAL:
            _flush_log()
        _original_on_pty_read(self, filtered)

    TermSocket.on_pty_read = _filtered_on_pty_read
    patches = ["CPR filter"]

    from tornado.ioloop import IOLoop

    _original_open = TermSocket.open
    _last_bounce = {}  # terminal name -> monotonic time of last step

    def _replay_steps(text):
        if DEFAULTS["strip_replay_queries"]:
            text = strip_replay_queries(text)
        if DEFAULTS["clear_before_replay"]:
            text = clear_before_replay(text)
        return text

    def _patched_open(self, url_component=None):
        if not patch_enabled(server_app, SWITCH_KEY):
            _original_open(self, url_component)
            return

        replays = []  # the replay texts the original open handed to the hook
        if DEFAULTS["suppress_buffer_replay"]:
            self.on_pty_read = lambda text: None
        elif DEFAULTS["strip_replay_queries"] or DEFAULTS["clear_before_replay"]:

            def replay(text):
                replays.append(text)
                # the replay still goes through the response filter on the class
                type(self).on_pty_read(self, _replay_steps(text))

            self.on_pty_read = replay
        _original_open(self, url_component)
        if (
            DEFAULTS["clear_before_replay"]
            and not DEFAULTS["suppress_buffer_replay"]
            and not replays
        ):
            # an empty buffer skips the hook (terminado replays only a non-empty
            # buffer); clear anyway, so a new shell starts on an empty screen
            type(self).on_pty_read(self, clear_before_replay(""))
        if (
            DEFAULTS["suppress_buffer_replay"]
            or DEFAULTS["strip_replay_queries"]
            or DEFAULTS["clear_before_replay"]
        ):
            try:
                del self.on_pty_read
            except AttributeError:
                pass
        if patch_enabled(server_app, REDRAW_OPTION):
            key = self.term_name
            now = time.monotonic()
            if now - _last_bounce.get(key, -_BOUNCE_DEBOUNCE) >= _BOUNCE_DEBOUNCE:
                # entries aged past the debounce window are inert; prune in place
                for stale in [
                    k
                    for k, ts in _last_bounce.items()
                    if now - ts >= _BOUNCE_DEBOUNCE
                ]:
                    del _last_bounce[stale]
                _last_bounce[key] = now
                IOLoop.current().call_later(
                    _BOUNCE_DELAY,
                    _make_winsize_bounce(
                        self.terminal.ptyproc, IOLoop.current().call_later
                    ),
                )

    TermSocket.open = _patched_open
    if DEFAULTS["suppress_buffer_replay"]:
        patches.append("buffer replay suppression")
    elif DEFAULTS["strip_replay_queries"]:
        patches.append("replay query stripping")
    if DEFAULTS["clear_before_replay"] and not DEFAULTS["suppress_buffer_replay"]:
        patches.append("clear before replay")
    if patch_enabled(server_app, REDRAW_OPTION):
        patches.append("repaint on attach")

    server_app.log.info(
        "jupyterlab_terminal_cpr_escape_fix: Patched TermSocket - %s",
        ", ".join(patches),
    )
