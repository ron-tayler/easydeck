import type { PanelFormat } from './panel-format.js';
import { alertAt, cornersOf, labelAt } from './scene.js';
import type { SceneBackground, SceneLabel, SceneRegion } from './scene.js';

/**
 * Cache identity, as short strings.
 *
 * Two rules keep this honest.
 *
 * A key names everything that changes the pixels and nothing that does not.
 * Miss something and a stale tile is shown for good; include something
 * irrelevant and the cache misses where it should have hit. The panel format
 * is in here for that reason — the same picture on a differently sized or
 * differently mounted panel is a different tile.
 *
 * And a key never contains the picture itself, only its `assetId`. That is the
 * whole point of `AssetRef`: these strings are built and compared constantly,
 * and one of them must never be a megabyte of base64.
 */

const NONE = '-';

/**
 * Identity of a region's composed picture, before it is cut into tiles.
 *
 * Labels are deliberately absent: they are drawn per key, on top, and two
 * regions differing only in their text share every pixel underneath.
 */
export function regionKey(format: PanelFormat, region: SceneRegion): string {
  const panel = `${format.tileWidth}x${format.tileHeight}+${format.gap}@${format.rotationDegrees}<${format.maxTileBytes}`;
  const image = region.image ? region.image.asset.id : NONE;

  return [
    panel,
    `${region.cols}x${region.rows}`,
    image,
    backgroundPart(region.background),
    region.cornerRadius ?? NONE,
  ].join('|');
}

/**
 * The background, as a string, whatever shape it has.
 *
 * A colour is itself. A gradient is written out field by field with its keys in
 * a fixed order, rather than passed to `JSON.stringify`, which follows the order
 * the object was built in: two gradients that draw the same picture would then
 * produce two keys, and the second one would compose a tile the cache already
 * held. Nothing here knows what the fields mean, which is what lets a gradient
 * gain one without this file being the place a stale tile comes from.
 */
function backgroundPart(background: SceneBackground | undefined): string {
  if (background === undefined) return NONE;
  return typeof background === 'string' ? background : stable(background);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;

  if (value !== null && typeof value === 'object') {
    const fields = Object.entries(value as Record<string, unknown>)
      .filter(([, held]) => held !== undefined)
      .sort(([one], [other]) => (one < other ? -1 : one > other ? 1 : 0))
      .map(([name, held]) => `${name}:${stable(held)}`);
    return `{${fields.join(',')}}`;
  }

  return JSON.stringify(value) ?? NONE;
}

/**
 * Identity of one key's finished tile: its share of the region, plus the text
 * on top and which corners it rounds.
 *
 * Takes the region key rather than recomputing it — a scene pass builds one
 * region key and many tile keys from it.
 */
export function tileKey(
  regionKeyValue: string,
  region: SceneRegion,
  col: number,
  row: number,
): string {
  const corners = cornersOf(region, col, row);
  const rounded =
    `${corners.topLeft ? 1 : 0}${corners.topRight ? 1 : 0}` +
    `${corners.bottomRight ? 1 : 0}${corners.bottomLeft ? 1 : 0}`;

  return [
    regionKeyValue,
    `${col},${row}`,
    rounded,
    alertAt(region, col, row) ? '!' : NONE,
    labelPart(labelAt(region, col, row)),
  ].join('|');
}

/**
 * Serialized rather than joined with a separator: label text is whatever the
 * user typed, so any separator can appear inside it and two different labels
 * could otherwise produce one key. JSON escapes, and on five short fields it
 * costs microseconds — the thing to keep out of these keys is the picture, not
 * a few characters of text.
 */
function labelPart(label: SceneLabel | undefined): string {
  if (!label) return NONE;

  return JSON.stringify([
    label.text,
    label.color ?? null,
    label.fontFamily ?? null,
    label.fontSize ?? null,
    label.position ?? null,
  ]);
}
