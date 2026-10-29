import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITerminalTracker } from '@jupyterlab/terminal';
import { Signal } from '@lumino/signaling';

import plugin, {
  PATCH_MARKER,
  POLL_INTERVAL_MS
} from '../fixes/restore-terminals';
import { requestAPI } from '../fixes/restore-terminals/request';

jest.mock('../fixes/restore-terminals/request');

const mockedRequestAPI = requestAPI as jest.MockedFunction<typeof requestAPI>;

/**
 * Build a terminal tracker stand-in that holds widgets with the given names.
 *
 * @param names - The terminal names the tracker reports
 * @returns A tracker-shaped object with a live `widgetAdded` signal
 */
function fakeTracker(names: string[]) {
  const widgets = names.map(name => ({
    content: { session: { model: { name } } }
  }));
  return {
    widgets,
    widgetAdded: new Signal<object, any>({}),
    forEach: (fn: (widget: any) => void) => widgets.forEach(fn)
  };
}

/**
 * Build a settings registry whose patch switch has the given value.
 *
 * @param value - The switch value the registry reports
 * @returns A registry stand-in for the activation gate
 */
function registryWithSwitch(value: boolean): ISettingRegistry {
  return {
    load: async () => ({
      get: () => ({ composite: value })
    })
  } as unknown as ISettingRegistry;
}

/**
 * Activate the plugin against a tracker stand-in.
 *
 * @param tracker - The tracker the plugin receives
 * @param registry - The settings registry, or `null` to leave the patch on
 */
async function activate(
  tracker: ReturnType<typeof fakeTracker>,
  registry: ISettingRegistry | null = null
): Promise<void> {
  const app = { serviceManager: { serverSettings: {} } };
  await plugin.activate!(app as any, tracker as any, registry);
}

/**
 * Read the terminal names posted by one request call.
 *
 * @param callIndex - The zero-based request call to inspect
 * @returns The names sent in the request body
 */
function postedNames(callIndex: number): string[] {
  const [endPoint, , init] = mockedRequestAPI.mock.calls[callIndex];
  expect(endPoint).toBe('state');
  expect(init!.method).toBe('POST');
  return JSON.parse(init!.body as string).names;
}

describe('jupyterlab_restore_terminals_fix', () => {
  it('should export a plugin with correct id', () => {
    expect(plugin.id).toBe('jupyterlab_restore_terminals_fix:plugin');
  });

  it('should require ITerminalTracker', () => {
    expect(plugin.requires).toContain(ITerminalTracker);
  });

  it('should have autoStart enabled', () => {
    expect(plugin.autoStart).toBe(true);
  });
});

describe('terminal state reporting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedRequestAPI.mockClear();
    delete (window as any)[PATCH_MARKER];
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    delete (window as any)[PATCH_MARKER];
  });

  it('posts a newly opened terminal within 5 s (ACC-RECORD-10)', async () => {
    const tracker = fakeTracker(['7']);
    await activate(tracker);

    tracker.widgetAdded.emit(tracker.widgets[0]);
    jest.advanceTimersByTime(5000);

    expect(mockedRequestAPI).toHaveBeenCalled();
    expect(postedNames(0)).toContain('7');
  });

  it('posts again every 15 s (ACC-RECORD-11)', async () => {
    const tracker = fakeTracker(['7']);
    await activate(tracker);

    jest.advanceTimersByTime(POLL_INTERVAL_MS - 1);
    expect(mockedRequestAPI).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(mockedRequestAPI).toHaveBeenCalledTimes(1);
    expect(postedNames(0)).toEqual(['7']);

    jest.advanceTimersByTime(POLL_INTERVAL_MS);
    expect(mockedRequestAPI).toHaveBeenCalledTimes(2);
    expect(postedNames(1)).toEqual(['7']);
  });

  it('posts an empty list when no terminal tab is open (ACC-REOPEN-4, DEF-FRONT-3)', async () => {
    await activate(fakeTracker([]));

    jest.advanceTimersByTime(POLL_INTERVAL_MS);

    expect(mockedRequestAPI).toHaveBeenCalledTimes(1);
    expect(postedNames(0)).toEqual([]);
  });

  it('schedules nothing when its switch is off', async () => {
    const tracker = fakeTracker(['7']);
    await activate(tracker, registryWithSwitch(false));

    tracker.widgetAdded.emit(tracker.widgets[0]);
    jest.advanceTimersByTime(POLL_INTERVAL_MS);

    expect(mockedRequestAPI).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect((window as any)[PATCH_MARKER]).toBeUndefined();
  });

  it('is a no-op when activated a second time', async () => {
    const first = fakeTracker(['1']);
    await activate(first);
    const second = fakeTracker(['2']);
    await activate(second);

    second.widgetAdded.emit(second.widgets[0]);
    jest.advanceTimersByTime(POLL_INTERVAL_MS);

    expect(mockedRequestAPI).toHaveBeenCalledTimes(1);
    expect(postedNames(0)).toEqual(['1']);
  });
});
