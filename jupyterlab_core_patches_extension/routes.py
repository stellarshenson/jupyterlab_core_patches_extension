"""Compose the server halves of the core patches.

Every patch module under :mod:`jupyterlab_core_patches_extension.server` may
export any of three entry points: ``setup_handlers(web_app)`` registers its
HTTP routes, ``prepopulate(server_app)`` does its startup work, and
``patch_term_socket(server_app)`` wraps the terminal websocket handler. The
module names keep the hyphens of the source packages they replace, so they are
imported by name rather than by an ``import`` statement.
"""

import importlib
import pkgutil


def _patch_modules():
    """Import and return every patch module in ``server/``, sorted by name.

    Returns:
        The imported modules that export a server entry point
    """
    from . import server

    modules = []
    infos = sorted(pkgutil.iter_modules(server.__path__), key=lambda i: i.name)
    for info in infos:
        if info.name.startswith("_"):
            continue
        modules.append(
            importlib.import_module(f".server.{info.name}", __package__)
        )
    return modules


def setup_route_handlers(web_app):
    """Register the HTTP routes of every patch that serves one.

    Args:
        web_app: The Tornado web application of the Jupyter server
    """
    for module in _patch_modules():
        setup_handlers = getattr(module, "setup_handlers", None)
        if setup_handlers is not None:
            setup_handlers(web_app)


def load_server_patches(server_app):
    """Run the startup and handler patches of every patch that has one.

    Args:
        server_app: The JupyterLab application being started
    """
    for module in _patch_modules():
        for entry_point in ("prepopulate", "patch_term_socket"):
            callback = getattr(module, entry_point, None)
            if callback is not None:
                callback(server_app)
