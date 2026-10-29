"""Serve the Jedi introspection template for the jump-to-definition patch.

The frontend executes the returned code inside the notebook kernel, so Jedi
resolves symbols against the kernel's ``sys.path`` rather than JupyterLab's
environment. The route keeps the path of the package this patch replaces.
"""

import json

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado

# The four __PLACEHOLDER__ tokens are replaced by the frontend before the code
# runs in the kernel.
INTROSPECTION_CODE = """
import sys
import os
import json

_result = {'file': None, 'line': None, 'error': None, 'in_notebook': False}

try:
    # Import Jedi
    try:
        import jedi
    except ImportError:
        _result['error'] = 'Jedi not installed in kernel environment. Install with: pip install jedi'
        print(json.dumps(_result))
        raise SystemExit

    # Parameters from frontend
    _notebook_source = __NOTEBOOK_SOURCE__
    _cursor_line = __CURSOR_LINE__
    _cursor_column = __CURSOR_COLUMN__
    _notebook_path = __NOTEBOOK_PATH__

    print(f'[Jedi] Analyzing at line {_cursor_line}, column {_cursor_column}', file=sys.stderr)
    print(f'[Jedi] Notebook source length: {len(_notebook_source)} chars', file=sys.stderr)
    print(f'[Jedi] Kernel sys.path has {len(sys.path)} entries', file=sys.stderr)

    # Create Jedi project with kernel's sys.path
    _project = jedi.Project(path=_notebook_path, sys_path=sys.path)

    # Create Jedi script
    _script = jedi.Script(code=_notebook_source, path=_notebook_path, project=_project)

    # Find definitions
    _definitions = _script.goto(
        line=_cursor_line,
        column=_cursor_column,
        follow_imports=True,
        follow_builtin_imports=True
    )

    print(f'[Jedi] Found {len(_definitions)} definition(s)', file=sys.stderr)

    if _definitions:
        _defn = _definitions[0]
        print(f'[Jedi] Definition: {_defn.name} at {_defn.module_path}:{_defn.line}', file=sys.stderr)

        if _defn.module_path:
            _defn_path = str(_defn.module_path)
            _result['file'] = _defn_path
            _result['line'] = _defn.line if _defn.line else 1
            # In-notebook definition: Jedi resolved the symbol to the notebook's
            # own concatenated source. Detect it here, inside the kernel, where the
            # real cwd lives, so the front end can jump in place instead of
            # reconstructing a filesystem path (which doubles when cwd == notebook dir).
            if _notebook_path and os.path.abspath(_notebook_path) == os.path.abspath(_defn_path):
                _result['in_notebook'] = True
        else:
            _result['error'] = f'Definition found but no source file available (builtin or compiled module)'
    else:
        _result['error'] = 'No definition found'

except SystemExit:
    pass
except Exception as _e:
    import traceback
    _result['error'] = f'Jedi error: {str(_e)}'
    print(f'[Jedi] Exception: {traceback.format_exc()}', file=sys.stderr)

print(json.dumps(_result))
"""


class IntrospectionCodeHandler(APIHandler):
    """Provide the Python introspection code to be executed in kernels."""

    @tornado.web.authenticated
    def get(self):
        """Return the Jedi template with its placeholders unresolved."""
        self.log.info("IntrospectionCodeHandler: GET request received")
        self.finish(json.dumps({"code": INTROSPECTION_CODE}))


def setup_handlers(web_app):
    """Register the introspection route under the source package's path.

    Args:
        web_app: The Tornado web application of the Jupyter server
    """
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    introspection_pattern = url_path_join(
        base_url, "jupyterlab-jump-to-definition-fix", "introspection-code"
    )

    web_app.add_handlers(
        host_pattern, [(introspection_pattern, IntrospectionCodeHandler)]
    )
