try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings

    warnings.warn(
        "Importing 'jupyterlab_core_patches_extension' outside a proper installation."
    )
    __version__ = "dev"


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "jupyterlab-core-patches-extension"}]


def _jupyter_server_extension_points():
    return [{"module": "jupyterlab_core_patches_extension"}]


def _load_jupyter_server_extension(server_app):
    """Register the server extension.

    Registers the HTTP routes of the patches that serve one and applies the
    patches that wrap server code. The other patches run in the browser only.

    Parameters
    ----------
    server_app: jupyterlab.labapp.LabApp
        JupyterLab application instance
    """
    from .routes import load_server_patches, setup_route_handlers

    setup_route_handlers(server_app.web_app)
    load_server_patches(server_app)

    name = "jupyterlab_core_patches_extension"
    server_app.log.info(f"Registered {name} server extension")
