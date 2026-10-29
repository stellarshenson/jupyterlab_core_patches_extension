"""Server tests for the terminal CPR escape patch.

Ported unchanged from the donor package's ``tests/test_handlers.py`` and
``tests/test_replay_clear.py``. Only the module import, the settings source
and the patch entry point differ: the combined module is loaded by name
because its file keeps the hyphen, and every switch is read through
``patch_enabled`` instead of the donor's ``DEFAULTS['repaint_on_attach']``.
"""

import importlib
import json
import logging
from collections import deque
from unittest import mock

import pytest
import tornado.ioloop
from jupyter_server_terminals.handlers import TermSocket

EXT = importlib.import_module(
    "jupyterlab_core_patches_extension.server.terminal-cpr-escape"
)

filter_terminal_responses = EXT.filter_terminal_responses
strip_replay_queries = EXT.strip_replay_queries
clear_before_replay = EXT.clear_before_replay
_make_winsize_bounce = EXT._make_winsize_bounce
_shell_at_prompt = EXT._shell_at_prompt
_BOUNCE_STEP = EXT._BOUNCE_STEP

# Settings stand-in. The donor suite toggled DEFAULTS['repaint_on_attach'];
# in the combined package only the four replay defaults stay module constants,
# and redrawBackgroundTerminals is read through patch_enabled on every attach.
ENABLED = {EXT.SWITCH_KEY: True, EXT.REDRAW_OPTION: True}


def _patch_enabled(server_app, key, default=True):
    """Return the switch value from ENABLED; unknown keys use default."""
    return ENABLED.get(key, default)


_PRISTINE_OPEN = TermSocket.open
_PRISTINE_ON_PTY_READ = TermSocket.on_pty_read


@pytest.fixture(autouse=True)
def _fresh_term_socket():
    """Run every test against the class as imported, then put back the caller's.

    pytest-jupyter loads the server extension in-process for the restore
    terminal suite, so TermSocket can already carry the CPR wrapper when this
    module's tests run. Installing a second wrapper over it runs every replay
    step twice; start from the imported methods instead.
    """
    open_, read = TermSocket.open, TermSocket.on_pty_read
    TermSocket.open, TermSocket.on_pty_read = _PRISTINE_OPEN, _PRISTINE_ON_PTY_READ
    yield
    TermSocket.open, TermSocket.on_pty_read = open_, read


def _install(app):
    """Install the TermSocket wrappers as a fresh patch.

    The combined module marks TermSocket after the first patch and returns
    early on a second call. The marker is cleared around the call, so every
    test starts from the unpatched class; the wrappers stay installed after
    the marker is removed and the caller restores the class methods.
    """
    with mock.patch.object(TermSocket, EXT._PATCH_MARKER, False, create=True):
        EXT.patch_term_socket(app)


class TestFilterEscPrefixed:
    """Tests for ESC-prefixed escape sequences."""

    def test_filters_cpr(self):
        result, counts, _ = filter_terminal_responses('\x1b[52;1R')
        assert result == ''
        assert counts['cpr'] == 1

    def test_filters_da(self):
        result, counts, _ = filter_terminal_responses('\x1b[?1;2c')
        assert result == ''
        assert counts['da'] == 1

    def test_filters_da2(self):
        result, counts, _ = filter_terminal_responses('\x1b[>0;276;0c')
        assert result == ''
        assert counts['da2'] == 1

    def test_filters_decrpm(self):
        result, counts, _ = filter_terminal_responses('\x1b[?12;2$y')
        assert result == ''
        assert counts['decrpm'] == 1

    def test_filters_osc10(self):
        result, counts, _ = filter_terminal_responses('\x1b]10;rgb:c3c3/c3c3/c3c3\x1b\\')
        assert result == ''
        assert counts['osc'] == 1

    def test_filters_osc11(self):
        result, counts, _ = filter_terminal_responses('\x1b]11;rgb:2525/2b2b/3232\x1b\\')
        assert result == ''
        assert counts['osc'] == 1

    def test_preserves_osc52_clipboard_bel(self):
        """OSC 52 clipboard sequences must pass through for clipboard extension."""
        osc52 = '\x1b]52;c;SGVsbG8gV29ybGQ=\x07'
        result, counts, _ = filter_terminal_responses(osc52)
        assert result == osc52
        assert counts['osc'] == 0

    def test_preserves_osc52_clipboard_st(self):
        """OSC 52 with ST terminator must also pass through."""
        osc52 = '\x1b]52;c;SGVsbG8gV29ybGQ=\x1b\\'
        result, counts, _ = filter_terminal_responses(osc52)
        assert result == osc52
        assert counts['osc'] == 0

    def test_filters_osc_but_preserves_osc52(self):
        """Other OSC filtered, OSC 52 preserved in same text."""
        osc10 = '\x1b]10;rgb:c3c3/c3c3/c3c3\x1b\\'
        osc52 = '\x1b]52;c;SGVsbG8=\x07'
        result, counts, _ = filter_terminal_responses(osc10 + osc52)
        assert result == osc52
        assert counts['osc'] == 1

    def test_preserves_color_codes(self):
        result, counts, _ = filter_terminal_responses('\x1b[32mgreen\x1b[0m')
        assert result == '\x1b[32mgreen\x1b[0m'
        assert sum(counts.values()) == 0

    def test_preserves_cursor_movement(self):
        result, counts, _ = filter_terminal_responses('\x1b[5A')
        assert result == '\x1b[5A'
        assert sum(counts.values()) == 0


class TestFilterBareSequences:
    """Tests for bare sequences (ESC stripped by shell)."""

    def test_filters_bare_cpr(self):
        """Fish shell strips ESC, outputs [row;colR as bare text."""
        result, counts, _ = filter_terminal_responses('[2;1R')
        assert result == ''
        assert counts['bare_cpr'] == 1

    def test_filters_multiple_bare_cpr(self):
        result, counts, _ = filter_terminal_responses('[2;2R[3;1R')
        assert result == ''
        assert counts['bare_cpr'] == 2

    def test_filters_bare_da(self):
        result, counts, _ = filter_terminal_responses('[?1;2c')
        assert result == ''
        assert counts['bare_da'] == 1

    def test_filters_bare_da2(self):
        result, counts, _ = filter_terminal_responses('[>0;276;0c')
        assert result == ''
        assert counts['bare_da2'] == 1

    def test_filters_bare_decrpm(self):
        result, counts, _ = filter_terminal_responses('[?12;2$y')
        assert result == ''
        assert counts['bare_decrpm'] == 1

    def test_filters_bare_osc_color_response(self):
        """Fish strips ESC from both ] introducer and ST, leaving ]11;rgb:..\\."""
        result, counts, _ = filter_terminal_responses(']10;rgb:c3c3/c3c3/c3c3\\')
        assert result == ''
        assert counts['bare_osc'] == 1

    def test_filters_multiple_bare_osc(self):
        text = ']10;rgb:c3c3/c3c3/c3c3\\]11;rgb:2525/2b2b/3232\\'
        result, counts, _ = filter_terminal_responses(text)
        assert result == ''
        assert counts['bare_osc'] == 2

    def test_filters_bare_osc4_palette(self):
        """OSC 4 palette response: ]4;idx;rgb:..\\."""
        result, counts, _ = filter_terminal_responses(']4;1;rgb:ffff/0000/0000\\')
        assert result == ''
        assert counts['bare_osc'] == 1

    def test_bare_osc_full_leaked_prompt(self):
        """Exact leaked bytes observed in a fish prompt after reconnect."""
        text = (
            '[?1;2cclear]10;rgb:c3c3/c3c3/c3c3\\]11;rgb:2525/2b2b/3232\\'
            '[?12;2$y[2;2R[3;1R[>0;276;0c]10;rgb:c3c3/c3c3/c3c3\\'
            ']11;rgb:2525/2b2b/3232\\[?12;2$y'
        )
        result, counts, _ = filter_terminal_responses(text)
        assert result == 'clear'

    def test_bare_cpr_mixed_with_text(self):
        result, counts, _ = filter_terminal_responses('prompt$ [2;2R[3;1R ')
        assert result == 'prompt$  '
        assert counts['bare_cpr'] == 2

    def test_bare_cpr_in_fish_prompt(self):
        """Real fish shell output: bare CPR at end of prompt line."""
        result, counts, _ = filter_terminal_responses(' base  ~/workspace  [2;2R[3;1R ')
        assert result == ' base  ~/workspace   '
        assert counts['bare_cpr'] == 2


class TestFilterMixed:
    """Tests for mixed ESC-prefixed and bare sequences."""

    def test_fish_shell_full_response(self):
        """Real fish shell response with all sequence types."""
        text = (
            '\x1b[?1;2c'
            '\x1b[2;2R'
            '\x1b[>0;276;0c'
            '\x1b]10;rgb:c3c3/c3c3/c3c3\x1b\\'
            '\x1b]11;rgb:2525/2b2b/3232\x1b\\'
            '\x1b[?12;2$y'
        )
        result, counts, _ = filter_terminal_responses(text)
        assert result == ''

    def test_mixed_esc_and_bare(self):
        text = '\x1b[52;1R[2;2R[3;1R'
        result, counts, _ = filter_terminal_responses(text)
        assert result == ''
        assert counts['cpr'] == 1
        assert counts['bare_cpr'] == 2

    def test_preserves_normal_text(self):
        result, counts, _ = filter_terminal_responses('Hello, World!')
        assert result == 'Hello, World!'
        assert sum(counts.values()) == 0

    def test_handles_empty_string(self):
        result, counts, _ = filter_terminal_responses('')
        assert result == ''
        assert sum(counts.values()) == 0

    def test_preserves_normal_brackets(self):
        """Normal text with brackets should not be filtered."""
        result, counts, _ = filter_terminal_responses('array[0] = 5')
        assert result == 'array[0] = 5'
        assert sum(counts.values()) == 0

    def test_fish_pty_actual_output(self):
        """Actual PTY output observed from fish shell CPR handling.

        Fish receives ESC[5;1R, strips ESC, outputs bare [5;1R
        interspersed with cursor movement sequences.
        """
        # Simplified version of actual fish output
        text = '[5;\r\x1b[71C1R\r\x1b[73C\x08\x08\x08\x08\x08[5;1R\r\x1b[73C'
        result, counts, _ = filter_terminal_responses(text)
        # The bare [5;1R should be filtered
        assert '[5;1R' not in result
        assert counts['bare_cpr'] >= 1


class TestSequenceComplement:
    """Complement tests: sequences that must NOT be filtered."""

    # --- Normal terminal output sequences (must be preserved) ---

    def test_preserves_sgr_color_256(self):
        """256-color SGR: ESC[38;5;NNNm"""
        text = '\x1b[38;5;231m'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_sgr_color_rgb(self):
        """RGB color SGR: ESC[38;2;R;G;Bm"""
        text = '\x1b[38;2;255;128;0m'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_sgr_reset(self):
        text = '\x1b[0m'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_cursor_up(self):
        text = '\x1b[5A'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_cursor_down(self):
        text = '\x1b[3B'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_cursor_forward(self):
        text = '\x1b[71C'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_cursor_back(self):
        text = '\x1b[2D'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_cursor_position(self):
        """CUP: ESC[row;colH - cursor positioning (not a response)."""
        text = '\x1b[10;20H'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_erase_line(self):
        text = '\x1b[K'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_erase_display(self):
        text = '\x1b[2J'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_scroll_up(self):
        text = '\x1b[3S'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_bracketed_paste_mode(self):
        """ESC[?2004h/l - bracketed paste mode on/off."""
        text = '\x1b[?2004h'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_alternate_screen(self):
        """ESC[?1049h/l - alternate screen buffer."""
        text = '\x1b[?1049h'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_dec_private_mode_set(self):
        """ESC[?25h - show cursor."""
        text = '\x1b[?25h'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_window_title_osc0(self):
        """OSC 0 sets window title - must NOT be filtered."""
        text = '\x1b]0;My Terminal\x07'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text
        assert counts['osc'] == 0

    def test_preserves_osc7_cwd(self):
        """OSC 7 sets working directory - must NOT be filtered."""
        text = '\x1b]7;file:///home/user\x07'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_osc8_hyperlink(self):
        """OSC 8 hyperlinks - must NOT be filtered."""
        text = '\x1b]8;;https://example.com\x07link\x1b]8;;\x07'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_osc133_prompt_mark(self):
        """OSC 133 shell integration - must NOT be filtered."""
        text = '\x1b]133;A\x07'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_osc10_query(self):
        """OSC 10 foreground color QUERY (?) - must pass through to terminal."""
        text = '\x1b]10;?\x07'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_osc11_query(self):
        """OSC 11 background color QUERY (?) - must pass through to terminal."""
        text = '\x1b]11;?\x07'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_osc12_query(self):
        """OSC 12 cursor color QUERY (?) - must pass through to terminal."""
        text = '\x1b]12;?\x1b\\'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_osc4_query_bel(self):
        """OSC 4 palette QUERY (index;?) - the ? follows the index, not the 4."""
        text = '\x1b]4;1;?\x07'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text
        assert counts['osc'] == 0

    def test_preserves_osc4_query_st(self):
        text = '\x1b]4;1;?\x1b\\'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text
        assert counts['osc'] == 0

    def test_filters_osc4_response_next_to_osc4_query(self):
        """OSC 4 palette response is still filtered; the query beside it stays."""
        query = '\x1b]4;1;?\x07'
        result, counts, _ = filter_terminal_responses(query + '\x1b]4;1;rgb:ffff/0000/0000\x1b\\')
        assert result == query
        assert counts['osc'] == 1

    def test_preserves_da2_query(self):
        """DA2 QUERY (ESC[>c or ESC[>0c) - must pass through to terminal."""
        assert filter_terminal_responses('\x1b[>c')[0] == '\x1b[>c'
        assert filter_terminal_responses('\x1b[>0c')[0] == '\x1b[>0c'

    def test_preserves_da_query(self):
        """DA QUERY (ESC[c or ESC[?c) - must pass through to terminal."""
        # Note: ESC[c has no ? prefix so our regex doesn't match it anyway
        # ESC[?c alone is also a query form
        assert filter_terminal_responses('\x1b[c')[0] == '\x1b[c'
        assert filter_terminal_responses('\x1b[?c')[0] == '\x1b[?c'

    def test_preserves_osc52_empty_payload(self):
        """OSC 52 with empty payload (clipboard query)."""
        osc52 = '\x1b]52;c;\x07'
        result, counts, _ = filter_terminal_responses(osc52)
        assert result == osc52
        assert counts['osc'] == 0

    def test_preserves_osc52_primary_selection(self):
        """OSC 52 with primary selection target."""
        osc52 = '\x1b]52;p;dGVzdA==\x07'
        result, counts, _ = filter_terminal_responses(osc52)
        assert result == osc52

    def test_preserves_osc52_large_payload(self):
        """OSC 52 with large base64 payload."""
        import base64
        payload = base64.b64encode(b'A' * 1000).decode()
        osc52 = f'\x1b]52;c;{payload}\x07'
        result, counts, _ = filter_terminal_responses(osc52)
        assert result == osc52

    # --- Plain text that resembles sequences (must be preserved) ---

    def test_preserves_array_index(self):
        text = 'data[0] = value'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_matrix_notation(self):
        text = 'matrix[3][5]'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_markdown_link(self):
        text = '[link](https://example.com)'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_git_output(self):
        text = '[main 6b3772e] fix: some commit message'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    def test_preserves_json_brackets(self):
        text = '{"items": [1, 2, 3]}'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text

    # --- bare_osc must not over-filter (protect from unwanted effects) ---

    def test_bare_osc_preserves_plain_text_close_bracket(self):
        """Plain text with ]10; but no rgb: payload must pass through."""
        text = 'see note]10; and continue'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text
        assert counts['bare_osc'] == 0

    def test_bare_osc_preserves_bare_osc_query(self):
        """Bare OSC color QUERY (]11;?\\) must not be stripped - it is rgb-less."""
        text = ']11;?\\'
        result, counts, _ = filter_terminal_responses(text)
        assert result == text
        assert counts['bare_osc'] == 0

    def test_bare_osc_does_not_double_count_esc_prefixed(self):
        """ESC-prefixed OSC is caught by 'osc', not 'bare_osc' (lookbehind)."""
        text = '\x1b]10;rgb:c3c3/c3c3/c3c3\x1b\\'
        result, counts, _ = filter_terminal_responses(text)
        assert result == ''
        assert counts['osc'] == 1
        assert counts['bare_osc'] == 0

    # --- Matched strings return value ---

    def test_matched_strings_returned(self):
        text = '\x1b[2;1R\x1b[?1;2c'
        _, _, matched = filter_terminal_responses(text)
        assert '\x1b[2;1R' in matched
        assert '\x1b[?1;2c' in matched

    def test_matched_strings_include_bare(self):
        text = '[2;2R[3;1R'
        _, _, matched = filter_terminal_responses(text)
        assert '[2;2R' in matched
        assert '[3;1R' in matched

    def test_matched_strings_empty_when_nothing_filtered(self):
        _, _, matched = filter_terminal_responses('hello world')
        assert matched == []


class TestBufferReplaySuppression:
    """Tests for the TermSocket.open() buffer replay suppression."""

    def test_no_replay_open_suppresses_on_pty_read(self):
        """Verify that _no_replay_open temporarily silences on_pty_read."""
        received = []

        class FakeTerminal:
            clients = []
            read_buffer = deque(['line1\n', 'line2\n'], maxlen=1000)

        class FakeTermManager:
            def get_terminal(self, name):
                return FakeTerminal()

        class FakeSocket:
            term_manager = FakeTermManager()
            term_name = ''
            terminal = None

            def on_pty_read(self, text):
                received.append(text)

            def send_json_message(self, msg):
                pass

        sock = FakeSocket()

        def simulated_open(self, url_component=None):
            self.term_name = url_component or 'tty'
            self.terminal = self.term_manager.get_terminal(url_component)
            self.terminal.clients.append(self)
            self.send_json_message(['setup', {}])
            buffered = ''
            preopen_buffer = self.terminal.read_buffer.copy()
            while preopen_buffer:
                buffered += preopen_buffer.popleft()
            if buffered:
                self.on_pty_read(buffered)

        FakeSocket.open = simulated_open

        _original_open = FakeSocket.open

        def _no_replay_open(self, url_component=None):
            self.on_pty_read = lambda text: None
            _original_open(self, url_component)
            try:
                del self.on_pty_read
            except AttributeError:
                pass

        FakeSocket.open = _no_replay_open

        sock.open('test')
        assert received == [], f"Buffer replay should be suppressed, got: {received}"

    def test_on_pty_read_restored_after_open(self):
        """After open(), on_pty_read must work normally for live PTY output."""
        received = []

        class FakeTerminal:
            clients = []
            read_buffer = deque(['old\n'], maxlen=1000)

        class FakeTermManager:
            def get_terminal(self, name):
                return FakeTerminal()

        class FakeSocket:
            term_manager = FakeTermManager()
            term_name = ''
            terminal = None

            def on_pty_read(self, text):
                received.append(text)

            def send_json_message(self, msg):
                pass

        def simulated_open(self, url_component=None):
            self.term_name = url_component or 'tty'
            self.terminal = self.term_manager.get_terminal(url_component)
            self.terminal.clients.append(self)
            self.send_json_message(['setup', {}])
            buffered = ''
            preopen_buffer = self.terminal.read_buffer.copy()
            while preopen_buffer:
                buffered += preopen_buffer.popleft()
            if buffered:
                self.on_pty_read(buffered)

        FakeSocket.open = simulated_open
        _original_open = FakeSocket.open

        def _no_replay_open(self, url_component=None):
            self.on_pty_read = lambda text: None
            _original_open(self, url_component)
            try:
                del self.on_pty_read
            except AttributeError:
                pass

        FakeSocket.open = _no_replay_open

        sock = FakeSocket()
        sock.open('test')
        assert received == []

        sock.on_pty_read('live output\n')
        assert received == ['live output\n']


class TestWinsizeBounce:
    """Tests for the repaint-on-attach PTY winsize bounce (_make_winsize_bounce)."""

    def _fake_term(self, rows=52, cols=160):
        class FakeTerm:
            def __init__(self):
                self.size = (rows, cols)
                self.calls = []

            def getwinsize(self):
                return self.size

            def setwinsize(self, r, c):
                self.calls.append((r, c))
                self.size = (r, c)

        return FakeTerm()

    def _fake_schedule(self):
        scheduled = []

        def schedule(delay, fn):
            scheduled.append((delay, fn))

        return scheduled, schedule

    def test_bounce_narrows_then_restores(self):
        """Bounce writes cols-1 (rows unchanged), then restores the original
        size one step later. A row step is DEF-BOUNCE-14: a row-addressing
        program loses the line it commits during the step."""
        term = self._fake_term()
        scheduled, schedule = self._fake_schedule()
        _make_winsize_bounce(term, schedule)()

        assert term.calls == [(52, 159)]
        assert len(scheduled) == 1 and scheduled[0][0] == _BOUNCE_STEP

        scheduled[0][1]()
        assert term.calls == [(52, 159), (52, 160)]
        assert term.size == (52, 160)

    def test_bounce_restore_guarded_against_racing_resize(self):
        """If a real client resize lands mid-bounce, the restore must not clobber it."""
        term = self._fake_term()
        scheduled, schedule = self._fake_schedule()
        _make_winsize_bounce(term, schedule)()

        term.setwinsize(40, 120)  # external resize racing the bounce
        term.calls.clear()
        scheduled[0][1]()
        assert term.calls == []
        assert term.size == (40, 120)

    def test_bounce_restore_keeps_resize_to_old_bounced_size(self):
        """A client resize to rows+1 during the step (the size the old row step
        wrote) is a real resize under the column step and is kept."""
        term = self._fake_term()
        scheduled, schedule = self._fake_schedule()
        _make_winsize_bounce(term, schedule)()

        term.setwinsize(53, 160)
        term.calls.clear()
        scheduled[0][1]()
        assert term.calls == []
        assert term.size == (53, 160)

    def test_bounce_restore_reverts_resize_to_bounced_size(self):
        """Documented limitation: a client resize to exactly (rows, cols-1)
        during the step is taken for the bounce and reverted."""
        term = self._fake_term()
        scheduled, schedule = self._fake_schedule()
        _make_winsize_bounce(term, schedule)()

        term.setwinsize(52, 159)  # client resize equal to the bounced size
        term.calls.clear()
        scheduled[0][1]()
        assert term.calls == [(52, 160)]
        assert term.size == (52, 160)

    def test_bounce_noop_when_getwinsize_fails(self):
        """A terminal that cannot report its size is left untouched."""
        class BadTerm:
            def getwinsize(self):
                raise OSError('no pty')

            def setwinsize(self, r, c):
                raise AssertionError('must not be called')

        scheduled, schedule = self._fake_schedule()
        _make_winsize_bounce(BadTerm(), schedule)()
        assert scheduled == []

    def test_bounce_noop_when_setwinsize_fails(self):
        """If the narrow write fails, no restore is scheduled."""
        class HalfBadTerm:
            def getwinsize(self):
                return (52, 160)

            def setwinsize(self, r, c):
                raise OSError('read-only pty')

        scheduled, schedule = self._fake_schedule()
        _make_winsize_bounce(HalfBadTerm(), schedule)()
        assert scheduled == []

    def test_loader_wires_bounce_to_real_ptyproc(self):
        """Drive the real patch and patched open: the bounce must reach the
        ptyproc of a PtyWithClients-shaped terminal. Regression pin - the
        wrapper has no winsize API, so wiring the bounce to it silently
        no-ops in production while fake-term unit tests stay green."""
        ptyproc = self._fake_term()

        class PtyWithClientsFake:
            """Shaped like terminado's PtyWithClients: no winsize surface."""

            def __init__(self, pp):
                self.ptyproc = pp

            def resize_to_smallest(self):
                pass

        callbacks = []

        class FakeLoop:
            def call_later(self, delay, fn, *args):
                callbacks.append(fn)

        class FakeSock:
            term_name = ''

            def __init__(self):
                self.terminal = PtyWithClientsFake(ptyproc)

            def on_pty_read(self, text):
                pass

        def simulated_open(self, url_component=None):
            self.term_name = url_component or 'tty'

        orig_open = TermSocket.open
        orig_read = TermSocket.on_pty_read
        try:
            TermSocket.open = simulated_open  # the patch captures this as _original_open
            with mock.patch.object(EXT, 'patch_enabled', _patch_enabled), \
                    mock.patch.object(tornado.ioloop.IOLoop, 'current', return_value=FakeLoop()):
                _install(mock.MagicMock())
                TermSocket.open(FakeSock(), '8')
                assert len(callbacks) == 1, f'expected 1 scheduled bounce, got {len(callbacks)}'
                callbacks[0]()  # bounce -> narrows, schedules restore
                assert len(callbacks) == 2, f'expected restore scheduled, got {len(callbacks)}'
                callbacks[1]()  # restore
        finally:
            TermSocket.open = orig_open
            TermSocket.on_pty_read = orig_read

        assert ptyproc.calls == [(52, 159), (52, 160)]

    def test_debounce_and_prune(self):
        """Second attach inside the window is debounced; after aging past it
        the terminal bounces again and stale _last_bounce entries are pruned
        (pins the debounce and the in-place prune from the review fixes)."""
        class PtyWithClientsFake:
            def __init__(self, pp):
                self.ptyproc = pp

        callbacks = []

        class FakeLoop:
            def call_later(self, delay, fn, *args):
                callbacks.append(fn)

        class FakeSock:
            def __init__(self, pp):
                self.terminal = PtyWithClientsFake(pp)
                self.term_name = ''

            def on_pty_read(self, text):
                pass

        def simulated_open(self, url_component=None):
            self.term_name = url_component or 'tty'

        orig_open = TermSocket.open
        orig_read = TermSocket.on_pty_read
        try:
            TermSocket.open = simulated_open  # the patch captures this as _original_open
            now = [1000.0]
            with mock.patch.object(EXT, 'patch_enabled', _patch_enabled), \
                    mock.patch.object(tornado.ioloop.IOLoop, 'current', return_value=FakeLoop()), \
                    mock.patch('time.monotonic', lambda: now[0]):
                _install(mock.MagicMock())
                TermSocket.open(FakeSock(self._fake_term()), '8')
                TermSocket.open(FakeSock(self._fake_term()), '8')  # inside the window -> debounced
                assert len(callbacks) == 1
                now[0] += 5.0                     # age past the debounce window
                TermSocket.open(FakeSock(self._fake_term()), '9')  # bounces; prunes stale '8'
                TermSocket.open(FakeSock(self._fake_term()), '8')  # '8' pruned -> treated as fresh
                assert len(callbacks) == 3
        finally:
            TermSocket.open = orig_open
            TermSocket.on_pty_read = orig_read

    def _foreground(self, comm, children=b'', pgids=None):
        """Patch the calls _shell_at_prompt makes. The foreground process group
        of the PTY is 4242. /proc/4242/comm holds the bytes `comm` and
        /proc/4242/task/4242/children holds the bytes `children`; an exception
        in place of the bytes is raised by `open`. os.getpgid answers from
        `pgids` (pid -> process group id, or an exception to raise)."""
        import contextlib
        import io
        import types

        files = {'/proc/4242/comm': comm, '/proc/4242/task/4242/children': children}

        def fake_open(path, mode='r'):
            data = files[path]
            if isinstance(data, Exception):
                raise data
            # text mode decodes, as the built-in open does
            return io.BytesIO(data) if 'b' in mode else io.StringIO(data.decode())

        def fake_getpgid(pid):
            pgid = (pgids or {})[pid]
            if isinstance(pgid, Exception):
                raise pgid
            return pgid

        @contextlib.contextmanager
        def patched():
            with mock.patch('os.tcgetpgrp', return_value=4242) as tcgetpgrp, \
                    mock.patch.object(EXT, 'open', side_effect=fake_open, create=True) as opened, \
                    mock.patch('os.getpgid', side_effect=fake_getpgid) as getpgid:
                yield types.SimpleNamespace(tcgetpgrp=tcgetpgrp, open=opened, getpgid=getpgid)

        return patched()

    def test_no_step_while_shell_alone_in_foreground(self):
        """A shell at its prompt gets no step: the size is not read, not
        written, and nothing is scheduled. A width step makes its line editor
        erase the output line above a typed line that fills the width."""
        term = mock.Mock(fd=7)
        scheduled, schedule = self._fake_schedule()
        with self._foreground(b'bash\n') as calls:
            _make_winsize_bounce(term, schedule)()

        calls.tcgetpgrp.assert_called_once_with(7)
        assert calls.open.call_args_list == [
            mock.call('/proc/4242/comm', 'rb'),
            mock.call('/proc/4242/task/4242/children', 'rb'),
        ]
        term.getwinsize.assert_not_called()
        term.setwinsize.assert_not_called()
        assert scheduled == []

    def test_step_runs_for_shell_with_child_in_its_group(self):
        """A shell without job control (sh -c, bash <script>) runs its program
        in its own process group; that program needs the repaint."""
        term = self._fake_term()
        term.fd = 7
        scheduled, schedule = self._fake_schedule()
        with self._foreground(b'sh\n', children=b'5001 ', pgids={5001: 4242}):
            _make_winsize_bounce(term, schedule)()

        assert term.calls == [(52, 159)]
        assert len(scheduled) == 1

    def test_step_runs_for_non_shell_leader(self):
        """A program that is not a shell (the job the shell started) is stepped."""
        term = self._fake_term()
        term.fd = 7
        scheduled, schedule = self._fake_schedule()
        with self._foreground(b'python3\n'):
            _make_winsize_bounce(term, schedule)()

        assert term.calls == [(52, 159)]
        assert len(scheduled) == 1

    def test_step_runs_when_tcgetpgrp_fails(self):
        """A PTY whose foreground process group cannot be read is stepped."""
        term = self._fake_term()
        term.fd = 7
        scheduled, schedule = self._fake_schedule()
        with mock.patch('os.tcgetpgrp', side_effect=OSError('not a terminal')):
            _make_winsize_bounce(term, schedule)()

        assert term.calls == [(52, 159)]
        assert len(scheduled) == 1

    def test_step_runs_for_term_without_fd(self):
        """A terminal object without `fd` is stepped; no process group is read."""
        term = self._fake_term()
        scheduled, schedule = self._fake_schedule()
        with mock.patch('os.tcgetpgrp') as pgrp:
            _make_winsize_bounce(term, schedule)()

        pgrp.assert_not_called()
        assert term.calls == [(52, 159)]
        assert len(scheduled) == 1

    @pytest.mark.parametrize('name', [b'bash', b'sh', b'dash', b'zsh', b'fish', b'ksh', b'tcsh', b'csh'])
    def test_shell_at_prompt_true_for_shell_alone(self, name):
        with self._foreground(name + b'\n'):
            assert _shell_at_prompt(mock.Mock(fd=7)) is True

    def test_shell_at_prompt_false_with_child_in_its_group(self):
        with self._foreground(b'bash\n', children=b'5001 ', pgids={5001: 4242}):
            assert _shell_at_prompt(mock.Mock(fd=7)) is False

    def test_shell_at_prompt_true_with_child_in_other_group(self):
        """A background job of an interactive shell has its own process group."""
        with self._foreground(b'bash\n', children=b'5001 ', pgids={5001: 5001}):
            assert _shell_at_prompt(mock.Mock(fd=7)) is True

    def test_shell_at_prompt_false_for_other_name(self):
        with self._foreground(b'python3\n'):
            assert _shell_at_prompt(mock.Mock(fd=7)) is False

    def test_shell_at_prompt_false_for_name_not_utf8(self):
        """A process name that is not valid UTF-8 raises nothing."""
        with self._foreground(b'\xff\xfe\n'):
            assert _shell_at_prompt(mock.Mock(fd=7)) is False

    def test_shell_at_prompt_false_when_comm_file_missing(self):
        """The leader has exited, or the system has no /proc."""
        with self._foreground(FileNotFoundError('/proc/4242/comm')):
            assert _shell_at_prompt(mock.Mock(fd=7)) is False

    def test_shell_at_prompt_false_when_children_file_missing(self):
        """A kernel without /proc/<pid>/task/<pid>/children: the step always runs."""
        with self._foreground(b'bash\n', children=FileNotFoundError('/proc/4242/task/4242/children')):
            assert _shell_at_prompt(mock.Mock(fd=7)) is False

    def test_shell_at_prompt_false_when_child_exited(self):
        """A child that exits after the children file was read."""
        with self._foreground(b'bash\n', children=b'5001 ', pgids={5001: ProcessLookupError(3, 'No such process')}):
            assert _shell_at_prompt(mock.Mock(fd=7)) is False


def _attach(chunks, live=(), **toggles):
    """Drive the real patch over the real TermSocket.open: attach a socket
    whose terminal holds `chunks` in read_buffer, then feed `live` to the
    socket as PTY output. Returns the text of every stdout frame sent."""
    class FakeTerminal:
        def __init__(self):
            self.clients = []
            self.read_buffer = deque(chunks, maxlen=1000)
            self.ptyproc = None

    class FakeTermManager:
        def get_terminal(self, name):
            return FakeTerminal()

    class FakeLoop:
        def call_later(self, delay, fn, *args):
            pass

    class Sock(TermSocket):
        """Real TermSocket methods; no tornado request, frames captured."""
        ping_interval = 0
        request = mock.MagicMock(path='/terminals/websocket/8')

        def __init__(self):
            self.term_manager = FakeTermManager()
            self._logger = logging.getLogger(__name__)
            self._enable_output_logging = False
            self.frames = []

        def write_message(self, message, binary=False):
            self.frames.append(json.loads(message))

    repaint = toggles.pop('repaint_on_attach', True)
    orig_open = TermSocket.open
    orig_read = TermSocket.on_pty_read
    try:
        # these tests check the replay itself; clear_before_replay has its own tests
        with mock.patch.dict(EXT.DEFAULTS, {'clear_before_replay': False, **toggles}), \
                mock.patch.dict(ENABLED, {EXT.REDRAW_OPTION: repaint}), \
                mock.patch.object(EXT, 'patch_enabled', _patch_enabled), \
                mock.patch.object(tornado.ioloop.IOLoop, 'current', return_value=FakeLoop()):
            _install(mock.MagicMock())
            sock = Sock()
            TermSocket.open(sock, '8')
            for text in live:
                sock.on_pty_read(text)
    finally:
        TermSocket.open = orig_open
        TermSocket.on_pty_read = orig_read
    return [text for kind, text in sock.frames if kind == 'stdout']


class TestReplayQueryStrip:
    """Tests for removing terminal queries from the TermSocket.open buffer replay."""

    # every query form xterm.js answers when it parses the replay
    QUERIES = {
        'osc4_bel': '\x1b]4;1;?\x07',
        'osc4_st': '\x1b]4;1;?\x1b\\',
        'osc10_bel': '\x1b]10;?\x07',
        'osc10_st': '\x1b]10;?\x1b\\',
        'osc11_bel': '\x1b]11;?\x07',
        'osc11_st': '\x1b]11;?\x1b\\',
        'osc12_bel': '\x1b]12;?\x07',
        'osc12_st': '\x1b]12;?\x1b\\',
        'osc4_multi': '\x1b]4;1;?;2;?\x07',
        'osc10_multi': '\x1b]10;?;?\x1b\\',
        'da1_c': '\x1b[c',
        'da1_0c': '\x1b[0c',
        'da2_gt_c': '\x1b[>c',
        'da2_gt_0c': '\x1b[>0c',
        'dsr_5n': '\x1b[5n',
        'cpr_6n': '\x1b[6n',
        'decxcpr_q6n': '\x1b[?6n',
        'decrqm_private': '\x1b[?2004$p',
        'decrqm_ansi': '\x1b[4$p',
        'decrqss_qp': '\x1bP$q"p\x1b\\',
        'decrqss_m': '\x1bP$qm\x1b\\',
    }

    @pytest.mark.parametrize('query', list(QUERIES.values()), ids=list(QUERIES))
    def test_replay_query_removed(self, query):
        assert _attach(['$ ls\r\n', query, 'out\r\n']) == ['$ ls\r\nout\r\n']

    def test_strip_keeps_responses(self):
        """Responses to the stripped queries are never taken for queries."""
        for response in (
            '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[0n', '\x1b[12;1R', '\x1b[?12;1R',
            '\x1b[?2004;2$y', '\x1b[4;2$y', '\x1bP1$r0m\x1b\\', '\x1bP1$r61;1"p\x1b\\',
            '\x1b]11;rgb:2525/2b2b/3232\x1b\\', '\x1b]4;1;rgb:ffff/0000/0000\x1b\\',
        ):
            text = response + '$ '
            assert strip_replay_queries(text) == text, repr(response)

    def test_strip_removes_only_query_bytes(self):
        """Text, SGR, cursor moves, OSC 0/7/8/52/133, responses and the queries
        xterm.js does not answer (XTVERSION, XTWINOPS, kitty) are kept."""
        kept = [
            'plain text\r\n\x1b[32mgreen\x1b[0m\x1b[5A\x1b[10;20H\x1b[K',
            '\x1b]0;title\x07\x1b]7;file:///home/user\x07\x1b]8;;https://example.com\x07link\x1b]8;;\x07',
            '\x1b]52;c;SGVsbG8=\x07\x1b]133;A\x07\x1b[?1;2c\x1b]11;rgb:2525/2b2b/3232\x1b\\',
            '\x1b[>0q\x1b[14t\x1b[18t\x1b[?u$ ',
        ]
        queries = ['\x1b]11;?\x1b\\', '\x1b[c', '\x1bP$qm\x1b\\']
        text = kept[0] + queries[0] + kept[1] + queries[1] + kept[2] + queries[2] + kept[3]
        assert strip_replay_queries(text) == ''.join(kept)

    def test_query_tail_at_replay_start_kept(self):
        """The deque can drop the head of a query; the tail left at the start
        of the replay passes unchanged while a whole query later is removed."""
        for tail in (';?\x1b\\', '4;1;?\x07', '$qm\x1b\\'):
            assert _attach([tail + 'text', '\x1b[c', 'more']) == [tail + 'textmore']

    def test_trailing_queries_kept(self):
        """Queries with nothing printed after them may still be awaited."""
        assert _attach(['$ ', '\x1b[c']) == ['$ \x1b[c']
        assert _attach(['$ ', '\x1b]11;?\x07', '\x1b[c']) == ['$ \x1b]11;?\x07\x1b[c']
        assert _attach(['\x1b[c', '$ ']) == ['$ ']
        assert _attach(['\x1b[c', '$ ', '\x1b[c']) == ['$ \x1b[c']

    def test_live_query_after_open_unchanged(self):
        """The same bytes are stripped from the replay and reach the client
        byte for byte as live output after open."""
        text = '\x1b]11;?\x1b\\$ '
        assert _attach([text], live=[text, '\x1b[6n']) == ['$ ', text, '\x1b[6n']

    def test_strip_toggle_and_suppress_precedence(self):
        """On by default, also with repaint off; off sends the replay unchanged;
        suppress_buffer_replay wins over it."""
        chunks = ['a', '\x1b[c', 'b']
        assert EXT.DEFAULTS['strip_replay_queries'] is True
        assert _attach(chunks) == ['ab']
        assert _attach(chunks, repaint_on_attach=False) == ['ab']
        assert _attach(chunks, strip_replay_queries=False) == ['a\x1b[cb']
        assert _attach(chunks, suppress_buffer_replay=True) == []


CLEAR = '\x1b[H\x1b[2J\x1b[3J'
PREFIX_NO_SWITCH = CLEAR
PREFIX_ENTRY = '\x1b[?1049l' + CLEAR
PREFIX_LEAVE = '\x1b[?1049l' + CLEAR + '\x1b[?1049h'


class TestClearBeforeReplay:
    """The pure function: which prefix goes in front of which text."""

    def test_no_switch_clears_only(self):
        text = 'line1\r\nline2\r\n\x1b[32mgreen\x1b[0m'
        assert clear_before_replay(text) == PREFIX_NO_SWITCH + text

    def test_empty_text(self):
        assert clear_before_replay('') == PREFIX_NO_SWITCH

    @pytest.mark.parametrize('mode', ['47', '1047', '1049'])
    def test_first_switch_entry(self, mode):
        text = f'history\r\n\x1b[?{mode}hfull screen'
        assert clear_before_replay(text) == PREFIX_ENTRY + text

    @pytest.mark.parametrize('mode', ['47', '1047', '1049'])
    def test_first_switch_leave(self, mode):
        text = f'screen rows\x1b[?{mode}lprompt'
        assert clear_before_replay(text) == PREFIX_LEAVE + text

    def test_parameter_list_entry(self):
        text = 'a\x1b[?1049;25hb'
        assert clear_before_replay(text) == PREFIX_ENTRY + text

    def test_parameter_list_leave(self):
        text = 'a\x1b[?25;1047lb'
        assert clear_before_replay(text) == PREFIX_LEAVE + text

    def test_only_first_switch_counts(self):
        assert clear_before_replay('\x1b[?1049h x \x1b[?1049l') == PREFIX_ENTRY + '\x1b[?1049h x \x1b[?1049l'
        assert clear_before_replay('\x1b[?1049l x \x1b[?1049h') == PREFIX_LEAVE + '\x1b[?1049l x \x1b[?1049h'

    @pytest.mark.parametrize('sequence', [
        '\x1b[?2004h',          # bracketed paste
        '\x1b[?1000h',          # mouse reporting
        '\x1b[?25l',            # cursor visibility
        '\x1b[?1048h',          # save cursor, not a screen switch
        '\x1b[?10490h',         # a different number that contains 1049
        '\x1b[1049h',           # not a private mode
        '\x1b[?1049;2004;25',   # no final byte
    ])
    def test_other_sequences_are_no_switch(self, sequence):
        assert clear_before_replay(sequence) == PREFIX_NO_SWITCH + sequence

    def test_prefix_resets_no_input_mode(self):
        """No full reset (ESC c), no soft reset (ESC [ ! p), no mode sequence
        except the alternate screen."""
        for text in ('', '\x1b[?1049hx', '\x1b[?1049lx'):
            prefix = clear_before_replay(text)[:len(clear_before_replay(text)) - len(text)]
            assert prefix in (PREFIX_NO_SWITCH, PREFIX_ENTRY, PREFIX_LEAVE)
            assert '\x1bc' not in prefix
            assert '\x1b[!p' not in prefix

    @pytest.mark.parametrize('prefix', [PREFIX_NO_SWITCH, PREFIX_ENTRY, PREFIX_LEAVE])
    def test_response_filter_leaves_prefix_intact(self, prefix):
        filtered, counts, _ = filter_terminal_responses(prefix)
        assert filtered == prefix
        assert sum(counts.values()) == 0


def _attach_clear(chunks, live=(), spy=None, **toggles):
    """Drive the real patch over the real TermSocket.open: attach a socket
    whose terminal holds `chunks` in read_buffer, then feed `live` to it as PTY
    output. Returns the text of every stdout frame sent. `spy` is a list that
    receives 'strip' and 'clear' in call order."""
    class FakeTerminal:
        def __init__(self):
            self.clients = []
            self.read_buffer = deque(chunks, maxlen=1000)
            self.ptyproc = None

    class FakeTermManager:
        def get_terminal(self, name):
            return FakeTerminal()

    class FakeLoop:
        def call_later(self, delay, fn, *args):
            pass

    class Sock(TermSocket):
        """Real TermSocket methods; no tornado request, frames captured."""
        ping_interval = 0
        request = mock.MagicMock(path='/terminals/websocket/8')

        def __init__(self):
            self.term_manager = FakeTermManager()
            self._logger = logging.getLogger(__name__)
            self._enable_output_logging = False
            self.frames = []

        def write_message(self, message, binary=False):
            self.frames.append(json.loads(message))

    def recording(name, function):
        def call(text):
            spy.append(name)
            return function(text)
        return call

    repaint = toggles.pop('repaint_on_attach', True)
    patches = [
        mock.patch.dict(EXT.DEFAULTS, toggles),
        mock.patch.dict(ENABLED, {EXT.REDRAW_OPTION: repaint}),
        mock.patch.object(EXT, 'patch_enabled', _patch_enabled),
        mock.patch.object(tornado.ioloop.IOLoop, 'current', return_value=FakeLoop()),
    ]
    if spy is not None:
        patches.append(mock.patch.object(
            EXT, 'strip_replay_queries', recording('strip', EXT.strip_replay_queries)))
        patches.append(mock.patch.object(
            EXT, 'clear_before_replay', recording('clear', EXT.clear_before_replay)))
    orig_open = TermSocket.open
    orig_read = TermSocket.on_pty_read
    try:
        for patch in patches:
            patch.start()
        _install(mock.MagicMock())
        sock = Sock()
        TermSocket.open(sock, '8')
        for text in live:
            sock.on_pty_read(text)
    finally:
        for patch in reversed(patches):
            patch.stop()
        TermSocket.open = orig_open
        TermSocket.on_pty_read = orig_read
    return [text for kind, text in sock.frames if kind == 'stdout']


class TestPatchedOpen:
    """The prefix in front of the replay that TermSocket.open sends."""

    def test_default_is_on(self):
        assert EXT.DEFAULTS['clear_before_replay'] is True

    def test_prefix_present_replay_bytes_unchanged(self):
        assert _attach_clear(['a', 'b\r\n', '$ ']) == [PREFIX_NO_SWITCH + 'ab\r\n$ ']

    def test_alternate_screen_branches_in_open(self):
        assert _attach_clear(['x\x1b[?1049h', 'y']) == [PREFIX_ENTRY + 'x\x1b[?1049hy']
        assert _attach_clear(['x\x1b[?1049l', 'y']) == [PREFIX_LEAVE + 'x\x1b[?1049ly']

    def test_prefix_survives_response_filter_with_replies_in_replay(self):
        frames = _attach_clear(['a\x1b[2;2R', 'b'])
        assert frames == [PREFIX_NO_SWITCH + 'ab']

    def test_switch_off_replay_is_unchanged(self):
        assert _attach_clear(['a', 'b'], clear_before_replay=False) == ['ab']

    def test_live_output_gets_no_prefix(self):
        assert _attach_clear(['old'], live=['live 1', 'live 2']) == [PREFIX_NO_SWITCH + 'old', 'live 1', 'live 2']

    def test_nothing_sent_under_suppress_buffer_replay(self):
        assert _attach_clear(['a', 'b'], suppress_buffer_replay=True) == []
        assert _attach_clear(['a'], live=['live'], suppress_buffer_replay=True) == ['live']

    def test_clear_runs_with_query_stripping_off(self):
        assert _attach_clear(['a\x1b[cb', '$ '], strip_replay_queries=False) == [PREFIX_NO_SWITCH + 'a\x1b[cb$ ']
        # the replay hook is removed after open: live output is unchanged
        assert _attach_clear(['a'], live=['live'], strip_replay_queries=False) == [PREFIX_NO_SWITCH + 'a', 'live']

    def test_clear_runs_with_repaint_off(self):
        assert _attach_clear(['a'], repaint_on_attach=False) == [PREFIX_NO_SWITCH + 'a']

    def test_clear_is_the_only_installed_step(self):
        assert _attach_clear(['a'], strip_replay_queries=False, repaint_on_attach=False) == [PREFIX_NO_SWITCH + 'a']

    def test_empty_buffer_still_clears(self):
        """terminado replays only a non-empty buffer; the clear is sent anyway."""
        assert _attach_clear([], live=['banner']) == [PREFIX_NO_SWITCH, 'banner']

    def test_empty_buffer_switch_off_sends_nothing(self):
        assert _attach_clear([], live=['banner'], clear_before_replay=False) == ['banner']

    def test_empty_buffer_under_suppress_buffer_replay_sends_nothing(self):
        assert _attach_clear([], suppress_buffer_replay=True) == []
        assert _attach_clear([], live=['banner'], suppress_buffer_replay=True) == ['banner']

    def test_all_replay_steps_off_sends_replay_unchanged(self):
        assert _attach_clear(
            ['a\x1b[cb', '$ '], clear_before_replay=False, strip_replay_queries=False,
        ) == ['a\x1b[cb$ ']

    def test_order_strip_then_clear(self):
        spy = []
        frames = _attach_clear(['a\x1b[cb', '$ '], spy=spy)
        assert spy == ['strip', 'clear']
        assert frames == [PREFIX_NO_SWITCH + 'ab$ ']

    def test_spy_sees_only_enabled_steps(self):
        spy = []
        _attach_clear(['a'], spy=spy, strip_replay_queries=False)
        assert spy == ['clear']
        spy = []
        _attach_clear(['a'], spy=spy, clear_before_replay=False)
        assert spy == ['strip']
