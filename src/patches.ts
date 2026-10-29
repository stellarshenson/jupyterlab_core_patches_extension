import { ISettingRegistry } from '@jupyterlab/settingregistry';

/**
 * The settings schema owner. Every patch reads its switch from this schema.
 */
export const CORE_PATCHES_ID = 'jupyterlab_core_patches_extension:plugin';

/**
 * The class a CSS-only patch puts on `document.body` while it is enabled.
 */
export const PATCH_CLASS_PREFIX = 'jp-core-patches-';

/**
 * Read one patch switch from the shared settings schema.
 *
 * A missing setting registry or a failed load leaves the patch on, because the
 * schema default is `true` and a settings failure must not disable a patch.
 *
 * @param registry - The settings registry supplied to the plugin
 * @param key - The schema key that holds the patch switch
 * @returns `true` when the patch may run, `false` when its switch is off
 */
export async function isPatchEnabled(
  registry: ISettingRegistry | null,
  key: string
): Promise<boolean> {
  if (!registry) {
    return true;
  }
  try {
    const settings = await registry.load(CORE_PATCHES_ID);
    return settings.get(key).composite !== false;
  } catch (reason) {
    console.error(
      `Could not read the ${key} switch; leaving the patch on.`,
      reason
    );
    return true;
  }
}
