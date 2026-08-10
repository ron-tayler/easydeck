import type { AssetRef } from './asset.js';
import { InvalidSceneError } from './errors.js';
import { columnOf, keyCount, rowOf } from './panel-format.js';
import type { PanelFormat } from './panel-format.js';

/**
 * What the panel should look like — all of it, at once.
 *
 * The engine hands one of these over and stops there. It does not say which
 * key to write, in what order, or what a picture stretched over six of them
 * means for the key in the middle; those are consequences of the description,
 * and working them out is this zone's job.
 *
 * The unit is the **region**, not the key. A region is a rectangle of keys
 * showing one picture. An ordinary button is a region of one key — not a
 * special case with its own code path, just the smallest rectangle there is.
 */

export interface SceneLabel {
  /** Which key of the region this belongs to, zero-based inside the region. */
  readonly col: number;
  readonly row: number;
  readonly text: string;
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly position?: 'top' | 'center' | 'bottom';
}

export interface SceneImage {
  /**
   * The picture always fills the whole region edge to edge — a single key
   * included — and is cropped to do it. There is no inset mode: a key showing
   * a picture shows it across the whole key, with the label on top.
   */
  readonly asset: AssetRef;
}

export interface SceneRegion {
  /** Top-left key of the rectangle, in the panel's row-major numbering. */
  readonly key: number;
  readonly cols: number;
  readonly rows: number;
  readonly background?: string;
  readonly cornerRadius?: number;
  /** One picture for the whole region. Absent means a plain background. */
  readonly image?: SceneImage;
  /** At most one per key of the region; keys without one show no text. */
  readonly labels?: readonly SceneLabel[];
  /**
   * Keys of this region whose last press ended in an error, as `col,row`.
   *
   * Drawn as a warning sign on top of whatever the key shows, and gone again a
   * few seconds later. A deck has no window to put a message in — the D6 least
   * of all — so the key that failed says so itself, and the alternative is a
   * press that silently does nothing.
   */
  readonly alerts?: readonly { readonly col: number; readonly row: number }[];
}

export interface Scene {
  readonly regions: readonly SceneRegion[];
}

export const EMPTY_SCENE: Scene = { regions: [] };

/** The panel keys a region covers, in row-major order. */
export function regionKeys(format: PanelFormat, region: SceneRegion): number[] {
  const left = columnOf(format, region.key);
  const top = rowOf(format, region.key);
  const keys: number[] = [];

  for (let row = 0; row < region.rows; row++) {
    for (let col = 0; col < region.cols; col++) {
      keys.push((top + row) * format.cols + left + col);
    }
  }

  return keys;
}

/** This key's cell inside the region, or undefined if it is not covered. */
export function cellOf(
  format: PanelFormat,
  region: SceneRegion,
  key: number,
): { readonly col: number; readonly row: number } | undefined {
  const col = columnOf(format, key) - columnOf(format, region.key);
  const row = rowOf(format, key) - rowOf(format, region.key);
  if (col < 0 || col >= region.cols || row < 0 || row >= region.rows) return undefined;
  return { col, row };
}

export function labelAt(
  region: SceneRegion,
  col: number,
  row: number,
): SceneLabel | undefined {
  return region.labels?.find((label) => label.col === col && label.row === row);
}

/**
 * Which of the region's outer corners this cell owns.
 *
 * Only those get rounded. A key in the middle of a six-key picture that
 * rounded all four would bite a notch out of the image at every seam — the
 * corners face the panel, not the picture.
 */
export function cornersOf(
  region: SceneRegion,
  col: number,
  row: number,
): {
  readonly topLeft: boolean;
  readonly topRight: boolean;
  readonly bottomRight: boolean;
  readonly bottomLeft: boolean;
} {
  const first = { col: col === 0, row: row === 0 };
  const last = { col: col === region.cols - 1, row: row === region.rows - 1 };

  return {
    topLeft: first.col && first.row,
    topRight: last.col && first.row,
    bottomRight: last.col && last.row,
    bottomLeft: first.col && last.row,
  };
}

/**
 * Rejects a scene that could never be shown.
 *
 * Overlap is the interesting case: two regions claiming one key would each
 * believe they own it, and which picture survived would come down to iteration
 * order. Catching it here means the compositor's own bookkeeping — one tile per
 * key — is a fact rather than a hope.
 */
export function validateScene(format: PanelFormat, scene: Scene): void {
  const total = keyCount(format);
  const owner = new Map<number, SceneRegion>();

  for (const region of scene.regions) {
    if (region.cols < 1 || region.rows < 1) {
      throw new InvalidSceneError(
        `Region at key ${region.key} is ${region.cols}x${region.rows}; a region covers at least one key`,
      );
    }
    if (region.key < 0 || region.key >= total) {
      throw new InvalidSceneError(`Region key ${region.key} is outside the panel (0..${total - 1})`);
    }
    if (columnOf(format, region.key) + region.cols > format.cols) {
      throw new InvalidSceneError(
        `Region at key ${region.key} is ${region.cols} keys wide and runs off the right edge`,
      );
    }
    if (rowOf(format, region.key) + region.rows > format.rows) {
      throw new InvalidSceneError(
        `Region at key ${region.key} is ${region.rows} keys tall and runs off the bottom edge`,
      );
    }

    for (const key of regionKeys(format, region)) {
      const held = owner.get(key);
      if (held) {
        throw new InvalidSceneError(
          `Key ${key} is claimed by regions at ${held.key} and ${region.key}`,
        );
      }
      owner.set(key, region);
    }
  }
}

/** Whether this key of the region is flagged as having failed. */
export function alertAt(region: SceneRegion, col: number, row: number): boolean {
  return (region.alerts ?? []).some((cell) => cell.col === col && cell.row === row);
}
