/**
 * One notebook cell as the line arithmetic needs it: the model type and the
 * source text.
 */
export interface INotebookCell {
  model: {
    type: string;
    sharedModel: {
      getSource(): string;
    };
  };
}

/**
 * Join every code cell source with a newline, the form Jedi analyses.
 *
 * @param cells - The notebook widgets in display order
 * @returns The concatenated code-cell source
 */
export function collectCellSources(cells: readonly INotebookCell[]): string {
  const sources: string[] = [];
  for (const cell of cells) {
    if (cell.model.type === 'code') {
      sources.push(cell.model.sharedModel.getSource());
    }
  }
  return sources.join('\n');
}

/**
 * Convert a cursor inside one cell to a 1-based line in the joined source.
 *
 * @param cells - The notebook widgets in display order
 * @param activeCellIndex - Widget index of the cell that holds the cursor
 * @param cursorLine - 0-based line of the cursor inside that cell
 * @returns The 1-based line number that Jedi expects
 */
export function absoluteLine(
  cells: readonly INotebookCell[],
  activeCellIndex: number,
  cursorLine: number
): number {
  let line = cursorLine + 1;
  for (let i = 0; i < activeCellIndex; i++) {
    const cell = cells[i];
    if (cell.model.type === 'code') {
      line += cell.model.sharedModel.getSource().split('\n').length;
    }
  }
  return line;
}

/**
 * Map a 1-based line in the joined source back to a cell and a 0-based line
 * inside that cell. This is the inverse of `absoluteLine`, including its
 * treatment of non-code cells.
 *
 * @param cells - The notebook widgets in display order
 * @param line - 1-based line in the joined code-cell source
 * @returns The widget index and the line inside it, or `null` when the line
 * lies outside the code cells
 */
export function locateAbsoluteLine(
  cells: readonly INotebookCell[],
  line: number
): { cellIndex: number; lineInCell: number } | null {
  let remaining = line;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.model.type !== 'code') {
      continue;
    }
    const lineCount = cell.model.sharedModel.getSource().split('\n').length;
    if (remaining <= lineCount) {
      return { cellIndex: i, lineInCell: remaining - 1 };
    }
    remaining -= lineCount;
  }
  return null;
}
