import { ISettingRegistry } from '@jupyterlab/settingregistry';

import plugin, { PATCH_CLASS } from '../fixes/change-ui-font-size';

/**
 * Build a settings registry whose patch switch has the given value.
 */
function registryWithSwitch(value: boolean): ISettingRegistry {
  return {
    load: async () => ({
      get: () => ({ composite: value })
    })
  } as unknown as ISettingRegistry;
}

/**
 * Count how many times the patch class appears in the body class list.
 */
function patchClassCount(): number {
  return document.body.className
    .split(/\s+/)
    .filter(token => token === PATCH_CLASS).length;
}

describe('change-ui-font-size', () => {
  afterEach(() => {
    document.body.classList.remove(PATCH_CLASS);
  });

  it('adds the patch class when the switch is on', async () => {
    await plugin.activate!(null as any, registryWithSwitch(true));

    expect(document.body.classList.contains(PATCH_CLASS)).toBe(true);
  });

  it('leaves the DOM untouched when the switch is off', async () => {
    await plugin.activate!(null as any, registryWithSwitch(false));

    expect(document.body.classList.contains(PATCH_CLASS)).toBe(false);
  });

  it('is a no-op when the patch runs a second time', async () => {
    await plugin.activate!(null as any, registryWithSwitch(true));
    await plugin.activate!(null as any, registryWithSwitch(true));

    expect(patchClassCount()).toBe(1);
  });
});
