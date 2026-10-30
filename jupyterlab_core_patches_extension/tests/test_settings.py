import json
from types import SimpleNamespace

from jupyterlab_core_patches_extension.settings import patch_enabled

KEY = "jupyterlab_change_ui_font_size_fix"


def _write_settings(tmp_path, data):
    path = (
        tmp_path
        / "@stellarshenson/jupyterlab-core-patches-extension"
        / "plugin.jupyterlab-settings"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_absent_file_defaults_true(tmp_path):
    app = SimpleNamespace(user_settings_dir=str(tmp_path))
    assert patch_enabled(app, KEY) is True


def test_false_switch_reads_false(tmp_path):
    app = SimpleNamespace(user_settings_dir=str(tmp_path))
    _write_settings(tmp_path, {KEY: False})

    assert patch_enabled(app, KEY) is False


def test_other_keys_keep_their_default(tmp_path):
    app = SimpleNamespace(user_settings_dir=str(tmp_path))
    _write_settings(tmp_path, {KEY: False})

    assert patch_enabled(app, "jupyterlab_restore_terminals_fix") is True


def test_changed_file_is_read_again(tmp_path):
    app = SimpleNamespace(user_settings_dir=str(tmp_path))
    path = _write_settings(tmp_path, {KEY: False})
    assert patch_enabled(app, KEY) is False

    path.write_text(json.dumps({KEY: True}), encoding="utf-8")
    assert patch_enabled(app, KEY) is True
