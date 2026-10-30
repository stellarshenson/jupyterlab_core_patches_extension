import { JupyterFrontEnd } from '@jupyterlab/application';
import { nullTranslator } from '@jupyterlab/translation';

/**
 * The stock LSP command that the patch replaces for Python notebooks.
 */
export const STOCK_LSP_COMMAND_ID = 'lsp:jump-to-definition';

/**
 * The command that runs the Jedi analysis in the notebook kernel.
 */
export const KERNEL_JUMP_COMMAND_ID = 'notebook:jump-to-definition-kernel';

/**
 * Applications whose stock command this module has already overridden.
 */
const overriddenApps = new WeakSet<JupyterFrontEnd>();

/**
 * Route the stock LSP jump-to-definition command through the kernel command.
 *
 * The stock command is captured when it exists and re-registered with a
 * dispatcher: a Python notebook runs the kernel command, any other widget runs
 * the captured descriptor. When LSP loads after this call, its `added` event
 * triggers the same capture. A second call for the same application is a
 * no-op.
 *
 * @param app - The application whose command registry is patched
 * @param kernelCommandId - The command that runs the Jedi analysis in the kernel
 * @param isPythonNotebook - Returns `true` when the current widget is a Python
 * notebook with a running kernel
 */
export function installLspCommandOverride(
  app: JupyterFrontEnd,
  kernelCommandId: string,
  isPythonNotebook: () => boolean
): void {
  if (overriddenApps.has(app)) {
    return;
  }
  overriddenApps.add(app);

  const trans = nullTranslator.load('jupyterlab_core_patches_extension');

  // Track if we've already overridden the LSP command
  let lspCommandOverridden = false;

  // Override the stock LSP command when it becomes available
  const overrideLSPCommand = (): void => {
    if (lspCommandOverridden) {
      return; // Already overridden, don't do it again
    }

    if (!app.commands.hasCommand(STOCK_LSP_COMMAND_ID)) {
      return; // LSP command not available yet
    }

    // Get the stock command descriptor
    const descriptor = (app.commands as any)._commands.get(
      STOCK_LSP_COMMAND_ID
    );
    if (!descriptor) {
      return;
    }

    // Mark as overridden before we start to prevent re-entry
    lspCommandOverridden = true;

    // Remove the stock command
    (app.commands as any)._commands.delete(STOCK_LSP_COMMAND_ID);
    (app.commands as any)._commandChanged.emit({
      id: STOCK_LSP_COMMAND_ID,
      type: 'removed'
    });

    // Re-register with our logic
    app.commands.addCommand(STOCK_LSP_COMMAND_ID, {
      label: descriptor.label || trans.__('Jump to definition'),
      icon: descriptor.icon,
      describedBy: descriptor.describedBy ?? (() => ({})),
      execute: async (args?: any) => {
        // Check if we're in a Python notebook
        if (isPythonNotebook()) {
          // Use our Jedi-based implementation
          return app.commands.execute(kernelCommandId);
        }
        // Delegate to original LSP implementation
        if (descriptor.execute) {
          return descriptor.execute.call(undefined, args);
        }
      },
      isEnabled: () => {
        if (isPythonNotebook()) {
          // Use our isEnabled logic
          return true;
        }
        // Delegate to original LSP isEnabled
        if (descriptor.isEnabled) {
          return descriptor.isEnabled.call(undefined);
        }
        return false;
      }
    });
  };

  // Try immediately
  overrideLSPCommand();

  // Also listen for command changes in case LSP loads later
  if (!app.commands.hasCommand(STOCK_LSP_COMMAND_ID)) {
    (app.commands as any).commandChanged.connect((sender: any, args: any) => {
      if (args.id === STOCK_LSP_COMMAND_ID && args.type === 'added') {
        overrideLSPCommand();
      }
    });
  }
}
