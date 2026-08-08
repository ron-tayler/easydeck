import { regionKey, tileKey } from '../domain/keys.js';
import type { PanelFormat } from '../domain/panel-format.js';
import { cellOf, regionKeys, validateScene } from '../domain/scene.js';
import type { Scene, SceneRegion } from '../domain/scene.js';

/**
 * Turns "here is how the panel should look" into "here is what to redo".
 *
 * Planned against **what is physically on the panel**, not against the
 * previous scene. The two disagree more often than one would like: a device
 * that reconnected is blank however many scenes it was shown, and a write that
 * failed left one key behind while the rest went through. Comparing scenes
 * would call both of those "unchanged" and leave the panel wrong for good.
 */

export interface PlannedTile {
  /** Panel key, in row-major numbering. */
  readonly key: number;
  /** Cell inside its region. */
  readonly col: number;
  readonly row: number;
  readonly tileKey: string;
}

export interface PlannedRegion {
  readonly region: SceneRegion;
  readonly regionKey: string;
  readonly tiles: readonly PlannedTile[];
  /** The subset that differs from what the panel is holding. */
  readonly stale: readonly PlannedTile[];
}

export interface ScenePlan {
  readonly regions: readonly PlannedRegion[];
  /** Keys holding something the new scene does not cover. */
  readonly cleared: readonly number[];
  /**
   * Region keys the new scene still wants.
   *
   * Background work is cancelled by *absence from this set*, not by the scene
   * it was started for. Paging away and back to the same picture would
   * otherwise throw away a decode that was seconds from finishing, and start
   * it again from nothing.
   */
  readonly live: ReadonlySet<string>;
}

export function planScene(
  format: PanelFormat,
  scene: Scene,
  onPanel: ReadonlyMap<number, string>,
): ScenePlan {
  validateScene(format, scene);

  const regions: PlannedRegion[] = [];
  const live = new Set<string>();
  const covered = new Set<number>();

  for (const region of scene.regions) {
    const key = regionKey(format, region);
    live.add(key);

    const tiles: PlannedTile[] = [];
    for (const panelKey of regionKeys(format, region)) {
      const cell = cellOf(format, region, panelKey)!;
      covered.add(panelKey);
      tiles.push({
        key: panelKey,
        col: cell.col,
        row: cell.row,
        tileKey: tileKey(key, region, cell.col, cell.row),
      });
    }

    regions.push({
      region,
      regionKey: key,
      tiles,
      stale: tiles.filter((tile) => onPanel.get(tile.key) !== tile.tileKey),
    });
  }

  const cleared: number[] = [];
  for (const key of onPanel.keys()) {
    if (!covered.has(key)) cleared.push(key);
  }

  return { regions, cleared: cleared.sort((a, b) => a - b), live };
}

/**
 * Whether this region needs any work at all.
 *
 * Kept separate from the plan because a region with nothing stale is still
 * *live*: if it is animating, it keeps animating. "Nothing to redraw" and
 * "nothing to do" are different things, and conflating them is how a picture
 * freezes the moment an unrelated key changes.
 */
export function needsWork(region: PlannedRegion): boolean {
  return region.stale.length > 0;
}
