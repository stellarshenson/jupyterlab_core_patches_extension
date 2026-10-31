# UI font size alignment

Scales file browser icons with the UI font size and centers item text against its icon. This page documents the patch inside `jupyterlab_core_patches_extension`, the direct replacement for the discrete `jupyterlab_change_ui_font_size_fix` package.

- **Switch** - `jupyterlab_change_ui_font_size_fix`, boolean, default `true`
- **Plugin id** - `@stellarshenson/jupyterlab-core-patches-extension:change-ui-font-size`
- **Patched member** - `.jp-DirListing-item`, `.jp-DirListing-itemIcon`, `.jp-DirListing-itemText`, `.jp-DirListing-itemText span` and `.jp-DirListing-itemIcon svg` in `style/change-ui-font-size.css`
- **Guard** - none in the source; the patch is idempotent because it only adds the body class `jp-core-patches-change-ui-font-size`, and `classList.add` does not add a class twice
- **Source** - `jupyterlab_change_ui_font_size_fix`
- **Jest test** - `src/__tests__/change-ui-font-size.spec.ts`
- **Galata test** - `ui-tests/tests/change-ui-font-size.spec.ts`

## Behaviour

The plugin reads its switch through `isPatchEnabled` and returns before touching the DOM when the switch is off. When the switch is on, it adds `jp-core-patches-change-ui-font-size` to `document.body`.

- **Scoping** - every selector in the stylesheet requires that body class, so the CSS stays inert while the switch is off
- **Apply time** - a switch change takes effect on the next page reload
- **Stock behaviour** - the icon keeps the theme's fixed SVG width while the text follows `--jp-ui-font-size1`
- **Test scope** - the Galata test asserts the body class and the computed icon size, not the visual misalignment, which depends on rendered metrics

## Icon sizing

The stylesheet keeps the source's two sizing modes. Set the variables in Settings > Advanced Settings Editor > Custom CSS.

- **Proportional** - default; icon size is `calc(var(--jp-ui-font-size1) * var(--jp-custom-icon-scale))`, scale default 1.5
- **Fixed** - icon size is `var(--jp-custom-icon-fixed-size)`, default 20px
- **Mode** - `--jp-custom-icon-mode` selects `proportional` or `fixed`

## Members

| Member        | Kind              | Purpose                                                          |
| ------------- | ----------------- | ---------------------------------------------------------------- |
| `PATCH_CLASS` | exported constant | The body class that enables the scoped CSS                       |
| `plugin`      | default export    | Declares the plugin id, reads the switch and adds the body class |
