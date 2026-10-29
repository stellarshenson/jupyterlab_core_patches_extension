import {
  absoluteLine,
  collectCellSources,
  INotebookCell,
  locateAbsoluteLine
} from '../fixes/jump-to-definition/lines';
import {
  installLspCommandOverride,
  KERNEL_JUMP_COMMAND_ID,
  STOCK_LSP_COMMAND_ID
} from '../fixes/jump-to-definition/override';

/**
 * Build one cell stub with a model type and a source.
 *
 * @param type - The cell model type
 * @param source - The cell source text
 * @returns The cell stub
 */
function cell(type: string, source: string): INotebookCell {
  return {
    model: {
      type,
      sharedModel: {
        getSource: () => source
      }
    }
  };
}

describe('collectCellSources', () => {
  it('joins code cells with a newline and skips markdown', () => {
    expect(
      collectCellSources([
        cell('code', 'a = 1'),
        cell('markdown', '# title'),
        cell('code', 'b = 2')
      ])
    ).toBe('a = 1\nb = 2');
  });

  it('returns an empty string when no cell is code', () => {
    expect(collectCellSources([cell('markdown', '# title')])).toBe('');
  });
});

describe('absoluteLine', () => {
  it('is the 1-based cursor line inside the first code cell', () => {
    expect(absoluteLine([cell('code', 'a\nb')], 0, 1)).toBe(2);
  });

  it('counts the lines of every preceding code cell', () => {
    expect(
      absoluteLine([cell('code', 'a\nb'), cell('code', 'c\nd')], 1, 0)
    ).toBe(3);
  });

  it('does not count a preceding markdown cell', () => {
    expect(
      absoluteLine([cell('markdown', 'x\ny\nz'), cell('code', 'a\nb')], 1, 0)
    ).toBe(1);
  });
});

describe('locateAbsoluteLine', () => {
  it('maps a line inside the first code cell', () => {
    expect(
      locateAbsoluteLine([cell('code', 'a\nb'), cell('code', 'c')], 2)
    ).toEqual({ cellIndex: 0, lineInCell: 1 });
  });

  it('maps the first line of the next code cell across the join', () => {
    expect(
      locateAbsoluteLine([cell('code', 'a\nb'), cell('code', 'c')], 3)
    ).toEqual({ cellIndex: 1, lineInCell: 0 });
  });

  it('returns null past the last code cell', () => {
    expect(locateAbsoluteLine([cell('code', 'a')], 2)).toBeNull();
  });
});

/**
 * The parts of a command registry that the override touches.
 */
interface IFakeCommandRegistry {
  hasCommand(id: string): boolean;
  addCommand(id: string, descriptor: any): void;
  execute(id: string): Promise<any>;
  _commands: Map<string, any>;
  _commandChanged: { emit(args: any): void };
  commandChanged: { connect(slot: (sender: any, args: any) => void): void };
}

/**
 * Build an application stub with a working command map.
 *
 * @param stock - The stock descriptor to install before the override runs
 * @returns The stub application and the spies around it
 */
function fakeApp(stock?: any): {
  app: any;
  commands: Map<string, any>;
  registry: IFakeCommandRegistry;
  addCommand: jest.Mock;
  execute: jest.Mock;
  connect: jest.Mock;
  emitted: any[];
} {
  const commands = new Map<string, any>();
  if (stock) {
    commands.set(STOCK_LSP_COMMAND_ID, stock);
  }
  const addCommand = jest.fn((id: string, descriptor: any) => {
    commands.set(id, descriptor);
  });
  const execute = jest.fn(async (id: string) => id);
  const connect = jest.fn();
  const emitted: any[] = [];
  const registry: IFakeCommandRegistry = {
    hasCommand: (id: string) => commands.has(id),
    addCommand,
    execute,
    _commands: commands,
    _commandChanged: {
      emit: (args: any) => emitted.push(args)
    },
    commandChanged: { connect }
  };
  return {
    app: { commands: registry },
    commands,
    registry,
    addCommand,
    execute,
    connect,
    emitted
  };
}

describe('installLspCommandOverride', () => {
  it('captures the stock command and keeps its label and icon', () => {
    const original = {
      label: 'Jump to definition',
      icon: 'jump',
      execute: jest.fn()
    };
    const { app, commands } = fakeApp(original);

    installLspCommandOverride(app, KERNEL_JUMP_COMMAND_ID, () => true);

    const patched = commands.get(STOCK_LSP_COMMAND_ID);
    expect(patched).not.toBe(original);
    expect(patched.label).toBe('Jump to definition');
    expect(patched.icon).toBe('jump');
  });

  it('runs the kernel command in a Python notebook', async () => {
    const original = { label: 'Jump to definition', execute: jest.fn() };
    const { app, commands, execute } = fakeApp(original);
    installLspCommandOverride(app, KERNEL_JUMP_COMMAND_ID, () => true);

    await commands.get(STOCK_LSP_COMMAND_ID).execute();

    expect(execute).toHaveBeenCalledWith(KERNEL_JUMP_COMMAND_ID);
    expect(original.execute).not.toHaveBeenCalled();
  });

  it('delegates to the stock command outside a Python notebook', async () => {
    const original = {
      label: 'Jump to definition',
      execute: jest.fn(async () => 'stock'),
      isEnabled: jest.fn(() => true)
    };
    const { app, commands } = fakeApp(original);
    installLspCommandOverride(app, KERNEL_JUMP_COMMAND_ID, () => false);

    const patched = commands.get(STOCK_LSP_COMMAND_ID);
    await patched.execute('arg');

    expect(original.execute).toHaveBeenCalledWith('arg');
    expect(patched.isEnabled()).toBe(true);
    expect(original.isEnabled).toHaveBeenCalled();
  });

  it('is a no-op on a second call', () => {
    const original = { label: 'Jump to definition', execute: jest.fn() };
    const { app, commands, addCommand, connect, emitted } = fakeApp(original);

    installLspCommandOverride(app, KERNEL_JUMP_COMMAND_ID, () => true);
    const first = commands.get(STOCK_LSP_COMMAND_ID);
    const additions = addCommand.mock.calls.length;
    const events = emitted.length;

    installLspCommandOverride(app, KERNEL_JUMP_COMMAND_ID, () => true);

    expect(addCommand).toHaveBeenCalledTimes(additions);
    expect(emitted).toHaveLength(events);
    expect(connect).not.toHaveBeenCalled();
    expect(commands.get(STOCK_LSP_COMMAND_ID)).toBe(first);
  });

  it('waits for a stock command that loads later', () => {
    const { app, commands, connect, addCommand } = fakeApp();
    installLspCommandOverride(app, KERNEL_JUMP_COMMAND_ID, () => true);

    expect(connect).toHaveBeenCalledTimes(1);

    const late = { label: 'Jump to definition', execute: jest.fn() };
    commands.set(STOCK_LSP_COMMAND_ID, late);
    const slot = connect.mock.calls[0][0];
    slot(app.commands, { id: STOCK_LSP_COMMAND_ID, type: 'added' });

    expect(addCommand).toHaveBeenCalledTimes(1);
    expect(commands.get(STOCK_LSP_COMMAND_ID)).not.toBe(late);
  });

  it('ignores the added event of another command', () => {
    const { app, commands, connect } = fakeApp();
    installLspCommandOverride(app, KERNEL_JUMP_COMMAND_ID, () => true);

    const late = { label: 'Jump to definition', execute: jest.fn() };
    commands.set(STOCK_LSP_COMMAND_ID, late);
    const slot = connect.mock.calls[0][0];
    slot(app.commands, { id: 'other:command', type: 'added' });

    expect(commands.get(STOCK_LSP_COMMAND_ID)).toBe(late);
  });
});
