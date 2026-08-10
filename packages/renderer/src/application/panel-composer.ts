import type { LabelSpec } from '../domain/button-visual.js';
import type { RgbaBitmap } from '../domain/render-target.js';

/**
 * Drawing a picture across a rectangle of keys, in two steps.
 *
 * The rectangle is composed **once**, at its full size across the panel, and
 * then cut into tiles. Doing it the other way round — laying the whole picture
 * out again for each key and shifting the canvas — is what the old path did,
 * and it costs the composition N times over for an N-key region.
 *
 * Both steps live here rather than in the compositor because both are pixels,
 * and this zone is the only one that knows what a pixel is.
 */

export interface RegionRequest {
  /** A path, a data URL, or the bytes themselves. Absent means plain background. */
  readonly source?: string | Uint8Array;
  readonly background?: string;
  /** The size of the whole region in pixels, gaps between displays included. */
  readonly width: number;
  readonly height: number;
}

export interface TileCorners {
  readonly topLeft: boolean;
  readonly topRight: boolean;
  readonly bottomRight: boolean;
  readonly bottomLeft: boolean;
}

export interface TileRequest {
  /** Where this tile starts inside the composed region. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Clockwise rotation baked into the output, for how the panel is mounted. */
  readonly rotationDegrees: 0 | 90 | 180 | 270;
  /** Drawn on top of the picture. Never inset — the picture keeps the whole tile. */
  readonly label?: LabelSpec;
  /**
   * Whether a picture sits under the text.
   *
   * Decides where an unpositioned label goes: over a picture it drops to the
   * bottom, where it covers the least, and on a plain key it takes the middle.
   */
  readonly hasPicture?: boolean;
  /**
   * Which corners face the panel rather than the picture. Only those are
   * rounded: a key in the middle of a stretched picture that rounded all four
   * would bite a notch out of the image at every seam.
   */
  readonly corners: TileCorners;
  readonly cornerRadius?: number;
  /**
   * Draws a warning sign over this tile.
   *
   * The panel is the only screen a physical deck has, so a press that failed
   * has nowhere else to say so.
   */
  readonly alert?: boolean;
}

/**
 * A composed frame, ready to be cut up.
 *
 * Opaque on purpose, and short-lived: the composer reuses one canvas across
 * the frames of an animation, so this is only valid until the next
 * `composeFrame`. Cut every tile you need before asking for another frame.
 */
export interface ComposedRegion {
  readonly width: number;
  readonly height: number;
}

/**
 * An opened picture, laid out over one region.
 *
 * A still is a source with one frame — not a separate concept, and not a
 * separate code path.
 */
export interface RegionSource {
  readonly frameCount: number;
  /** Per-frame durations, in order. A still has one entry of 0. */
  readonly delaysMs: readonly number[];
  /** Frames must be asked for in order; going back replays from the start. */
  composeFrame(index: number): ComposedRegion;
  close(): void;
}

export interface PanelComposer {
  open(request: RegionRequest): Promise<RegionSource>;
  cutTile(region: ComposedRegion, request: TileRequest): RgbaBitmap;
  /**
   * A finished tile drawn smaller, centred on black — the deck's answer to a
   * finger on a key.
   *
   * Takes the encoded tile rather than recomposing the region behind it. The
   * picture that produced it may be a hundred-frame animation whose decoder
   * has long since been released, and reopening one to shrink a single key
   * would make the panel answer a press in tenths of a second.
   */
  shrinkTile(tile: Uint8Array, request: ShrinkTileRequest): Promise<RgbaBitmap>;
}

export interface ShrinkTileRequest {
  readonly width: number;
  readonly height: number;
  /** 0..1 of the original size. */
  readonly scale: number;
}
