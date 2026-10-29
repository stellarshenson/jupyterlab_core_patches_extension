import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  IRouter
} from '@jupyterlab/application';

import { IMarkdownViewerTracker } from '@jupyterlab/markdownviewer';

import { IRenderMimeRegistry } from '@jupyterlab/rendermime';

import {
  ITableOfContentsTracker,
  TableOfContents,
  TableOfContentsUtils
} from '@jupyterlab/toc';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { isPatchEnabled } from '../patches';

import {
  NAMED_ID_ATTRIBUTE,
  anchorAttribute,
  cleanFragment,
  findFragmentTarget
} from './markdown-viewer-toc/fragment';

/**
 * The window key that records an active patch. A second activation reads it
 * and returns, so the renderer prototype and the tracker signals are patched
 * once.
 */
export const PATCH_MARKER = '__jp_markdown_viewer_toc_fix__';

/**
 * The switch key in the shared settings schema.
 */
const SWITCH_KEY = 'jupyterlab_markdown_viewer_toc_fix';

/**
 * Patches the `RenderedHTMLCommon.setFragment` method to handle both `id` and
 * `data-jupyter-id` attributes. This fixes anchor navigation in the Markdown
 * Viewer when `allowNamedProperties` is false.
 */
function patchFragmentNavigation(
  renderMimeRegistry: IRenderMimeRegistry
): void {
  const proto = Object.getPrototypeOf(
    renderMimeRegistry.createRenderer('text/html')
  );

  if (!proto || !proto.setFragment) {
    return;
  }

  const originalSetFragment = proto.setFragment;

  proto.setFragment = function (this: any, fragment: string): void {
    let el: Element | null = null;
    try {
      const escaped = CSS.escape(cleanFragment(fragment));
      el =
        this.node.querySelector(`#${escaped}`) ||
        this.node.querySelector(`[${NAMED_ID_ATTRIBUTE}="${escaped}"]`);
    } catch (error) {
      // A fragment that cannot be parsed falls through to the stock method.
    }

    if (el) {
      el.scrollIntoView();
    } else {
      // Fall back to the original implementation if our approach fails.
      originalSetFragment.call(this, fragment);
    }
  };
}

/**
 * Scrolls to the element a fragment points at, using the attribute the
 * sanitizer leaves on the heading.
 */
function scrollToFragment(
  fragment: string,
  contentNode: HTMLElement,
  renderMimeRegistry: IRenderMimeRegistry
): boolean {
  const allowNamedProperties =
    renderMimeRegistry.sanitizer?.allowNamedProperties ?? false;
  const el = findFragmentTarget(contentNode, fragment, allowNamedProperties);

  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }

  return false;
}

/**
 * Patches the Markdown Viewer content's `setFragment` method for in-document
 * anchor links, and re-applies the fragment after a render.
 */
function patchMarkdownViewerFragment(
  widget: any,
  renderMimeRegistry: IRenderMimeRegistry
): void {
  const content = widget.content;
  if (!content || !content.setFragment) {
    return;
  }

  const originalSetFragment = content.setFragment.bind(content);

  content.setFragment = function (fragment: string): void {
    const success = scrollToFragment(
      fragment,
      content.node,
      renderMimeRegistry
    );
    if (!success) {
      originalSetFragment(fragment);
    }
  };

  // The hash this view last scrolled to. A render with the same hash is a
  // re-render of the document, not navigation, and must leave the reader
  // where they are.
  let scrolledHash = '';

  // Handle URL fragment changes (for in-document link clicks).
  const handleHashChange = () => {
    const hash = window.location.hash;
    scrolledHash = hash;
    if (hash && widget.isVisible) {
      // Small delay to ensure content is rendered.
      setTimeout(() => {
        scrollToFragment(hash, content.node, renderMimeRegistry);
      }, 100);
    }
  };

  // Listen to the rendered signal to handle fragments after content loads.
  content.rendered.connect(() => {
    const hash = window.location.hash;
    if (hash && hash !== scrolledHash) {
      scrolledHash = hash;
      setTimeout(() => {
        scrollToFragment(hash, content.node, renderMimeRegistry);
      }, 100);
    }
  });

  // Listen for hash changes (in-document link clicks).
  window.addEventListener('hashchange', handleHashChange);

  // Clean up on widget disposal.
  widget.disposed.connect(() => {
    window.removeEventListener('hashchange', handleHashChange);
  });
}

/**
 * Patches TOC navigation for a specific widget.
 */
function patchWidgetTOC(
  widget: any,
  tocTracker: ITableOfContentsTracker,
  renderMimeRegistry: IRenderMimeRegistry
): void {
  // Small delay to ensure the TOC model is created.
  setTimeout(() => {
    const tocModel = tocTracker.get(widget);

    if (!tocModel) {
      return;
    }

    tocModel.activeHeadingChanged.connect(
      async (
        model: TableOfContents.IModel<TableOfContents.IHeading>,
        heading: TableOfContents.IHeading | null
      ) => {
        if (!heading) {
          return;
        }

        // Get sanitizer settings.
        const sanitizer = renderMimeRegistry.sanitizer;
        const attribute = anchorAttribute(
          sanitizer?.allowNamedProperties ?? false
        );

        // Get the parser from the model.
        const parser = (model as any).parser;
        if (!parser) {
          return;
        }

        try {
          // Use the raw property when available (IMarkdownHeading), otherwise
          // use the text.
          const headingText = (heading as any).raw || heading.text;
          const elementId = await TableOfContentsUtils.Markdown.getHeadingId(
            parser,
            headingText,
            heading.level,
            sanitizer
          );

          if (!elementId) {
            return;
          }

          // Use the correct attribute selector based on sanitizer settings.
          const selector = `h${heading.level}[${attribute}="${CSS.escape(
            elementId
          )}"]`;
          const element = widget.content.node.querySelector(selector);

          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } catch (error) {
          // A heading that cannot be resolved leaves the view where it is.
        }
      }
    );
  }, 100);
}

/**
 * Sets up TOC navigation interception for Markdown Viewer widgets, existing
 * and future.
 */
function setupTOCNavigation(
  markdownViewerTracker: IMarkdownViewerTracker,
  tocTracker: ITableOfContentsTracker,
  renderMimeRegistry: IRenderMimeRegistry
): void {
  // Handle existing widgets.
  markdownViewerTracker.forEach(widget => {
    patchWidgetTOC(widget, tocTracker, renderMimeRegistry);
    patchMarkdownViewerFragment(widget, renderMimeRegistry);
  });

  // Monitor new markdown viewer widgets.
  markdownViewerTracker.widgetAdded.connect((_sender, widget) => {
    patchWidgetTOC(widget, tocTracker, renderMimeRegistry);
    patchMarkdownViewerFragment(widget, renderMimeRegistry);
  });
}

/**
 * Initialization data for the jupyterlab_markdown_viewer_toc_fix extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_markdown_viewer_toc_fix:plugin',
  description:
    'Fixes TOC navigation and anchor links in Markdown Viewer for JupyterLab 4.x',
  autoStart: true,
  requires: [
    IMarkdownViewerTracker,
    IRenderMimeRegistry,
    ITableOfContentsTracker
  ],
  optional: [IRouter, ISettingRegistry],
  activate: async (
    app: JupyterFrontEnd,
    markdownViewerTracker: IMarkdownViewerTracker,
    renderMimeRegistry: IRenderMimeRegistry,
    tocTracker: ITableOfContentsTracker,
    router: IRouter | null,
    settingRegistry: ISettingRegistry | null
  ): Promise<void> => {
    if (!(await isPatchEnabled(settingRegistry, SWITCH_KEY))) {
      return;
    }

    // A second activation would wrap the renderer prototype and connect the
    // tracker signals a second time.
    if ((window as any)[PATCH_MARKER]) {
      return;
    }
    (window as any)[PATCH_MARKER] = true;

    console.log(
      'JupyterLab extension jupyterlab_markdown_viewer_toc_fix is activated!'
    );

    patchFragmentNavigation(renderMimeRegistry);
    setupTOCNavigation(markdownViewerTracker, tocTracker, renderMimeRegistry);

    // Listen to the JupyterLab router for route changes.
    if (router) {
      router.routed.connect(() => {
        const hash = window.location.hash;

        if (hash) {
          const currentWidget = markdownViewerTracker.currentWidget;
          if (currentWidget && currentWidget.content) {
            setTimeout(() => {
              scrollToFragment(
                hash,
                currentWidget.content.node,
                renderMimeRegistry
              );
            }, 300);
          }
        }
      });
    }

    // Add a global hashchange listener as a fallback.
    window.addEventListener('hashchange', () => {
      const currentWidget = markdownViewerTracker.currentWidget;
      if (currentWidget && currentWidget.content) {
        setTimeout(() => {
          scrollToFragment(
            window.location.hash,
            currentWidget.content.node,
            renderMimeRegistry
          );
        }, 100);
      }
    });
  }
};

export default plugin;
