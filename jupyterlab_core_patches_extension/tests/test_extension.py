import json
from pathlib import Path

import jupyterlab_core_patches_extension as extension

PROJECT_ROOT = Path(__file__).parents[2]
PATCH_KEYS = [
    "jupyterlab_change_ui_font_size_fix",
    "jupyterlab_file_browser_column_width_fix",
    "jupyterlab_jump_to_definition_fix",
    "jupyterlab_markdown_switch_tab_scrolling_fix",
    "jupyterlab_markdown_syntax_rendering_fix",
    "jupyterlab_markdown_viewer_toc_fix",
    "jupyterlab_other_file_type_menu_fix",
    "jupyterlab_restore_terminals_fix",
    "jupyterlab_server_proxy_launcher_fix",
    "jupyterlab_terminal_cpr_escape_fix",
]


def test_labextension_paths():
    assert extension._jupyter_labextension_paths() == [
        {"src": "labextension", "dest": "jupyterlab-core-patches-extension"}
    ]


def test_server_extension_points():
    assert extension._jupyter_server_extension_points() == [
        {"module": "jupyterlab_core_patches_extension"}
    ]


def test_settings_schema_has_ten_switches():
    schema = json.loads(
        (PROJECT_ROOT / "schema" / "plugin.json").read_text(encoding="utf-8")
    )
    properties = schema["properties"]

    assert list(properties) == PATCH_KEYS + ["redrawBackgroundTerminals"]
    for key in PATCH_KEYS:
        assert properties[key]["type"] == "boolean"
        assert properties[key]["default"] is True
