/**
 * Grid geometry of a surface.
 *
 * Every public API in this package addresses keys by their *logical index*:
 * 0-based, row-major, starting at the top-left key. Translation to whatever
 * numbering the hardware uses internally happens in the infrastructure layer.
 */
export interface KeyLayout {
  readonly rows: number;
  readonly cols: number;
}

export function keyCount(layout: KeyLayout): number {
  return layout.rows * layout.cols;
}

export function isValidKey(layout: KeyLayout, key: number): boolean {
  return Number.isInteger(key) && key >= 0 && key < keyCount(layout);
}

export function toRowCol(layout: KeyLayout, key: number): { row: number; col: number } {
  if (!isValidKey(layout, key)) {
    throw new RangeError(`Key index ${key} is out of range for a ${layout.rows}x${layout.cols} layout`);
  }
  return { row: Math.floor(key / layout.cols), col: key % layout.cols };
}

export function toKeyIndex(layout: KeyLayout, row: number, col: number): number {
  if (row < 0 || row >= layout.rows || col < 0 || col >= layout.cols) {
    throw new RangeError(`Position ${row}/${col} is out of range for a ${layout.rows}x${layout.cols} layout`);
  }
  return row * layout.cols + col;
}
