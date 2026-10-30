"""Read the extension's own switches from the JupyterLab user settings file.

The frontend writes the switches through the settings registry. Server-side
patches read the same file, so one switch turns off both halves of a patch.
"""

import json
import os
import threading
from pathlib import Path

PACKAGE = "@stellarshenson/jupyterlab-core-patches-extension"

_CACHE = {}
_LOCK = threading.Lock()


def _settings_path(server_app) -> Path:
    user_settings_dir = getattr(server_app, "user_settings_dir", None)
    if user_settings_dir is None:
        from jupyter_core.paths import jupyter_data_dir

        user_settings_dir = os.path.join(
            jupyter_data_dir(), "lab", "user-settings"
        )
    return Path(user_settings_dir) / PACKAGE / "plugin.jupyterlab-settings"


def patch_enabled(server_app, key: str, default: bool = True) -> bool:
    """Return the switch value for one patch.

    A missing file or a missing key returns ``default``. The file is re-read
    only when its modification time changes, so a terminal output path can
    call this on every chunk without reading the disk every time.

    Args:
        server_app: The JupyterLab application passed to the server extension
        key: The schema key that holds the patch switch
        default: The value to use when the file or key is absent

    Returns:
        ``False`` only when the stored value is exactly ``False``
    """
    path = _settings_path(server_app)
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        return default

    with _LOCK:
        cached = _CACHE.get(path)
        if cached is not None and cached[0] == mtime:
            data = cached[1]
        else:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return default
            _CACHE[path] = (mtime, data)

    value = data.get(key, default)
    return value is not False
