import type { AssetRef } from '../../domain/asset.js';
import type { RegionGeometry } from '../../domain/panel-format.js';

/**
 * Outbound port: everything that touches pixels.
 *
 * The compositor decides *what* the panel shows and *when*; this port knows
 * *how* to draw it. Two shapes matter here.
 *
 * A composed region is opaque. The compositor never reads its pixels — it
 * hands it straight back to `cutTile` — so the renderer is free to keep a
 * canvas, a bitmap or a GPU surface behind it without anyone else caring.
 *
 * And frames are asked for one at a time, in order. A GIF frame is usually a
 * patch over its predecessor, so random access would mean either replaying the
 * file or keeping every frame in memory — 23MB for a modest 76-frame icon.
 * Sequential access lets the whole animation cost one frame of memory.
 */

export interface ComposedRegion {
  readonly width: number;
  readonly height: number;
}

export interface TileBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface TileLabel {
  readonly text: string;
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly position?: 'top' | 'center' | 'bottom';
}

export interface TileCorners {
  readonly topLeft: boolean;
  readonly topRight: boolean;
  readonly bottomRight: boolean;
  readonly bottomLeft: boolean;
}

export interface CutTileRequest {
  /** Which cell of the region to cut out. */
  readonly col: number;
  readonly row: number;
  /** Drawn on top of the picture, never inset into it. */
  readonly label?: TileLabel;
  /** Which of this tile's corners face the panel rather than the picture. */
  readonly corners: TileCorners;
  readonly cornerRadius?: number;
  /** Draws a warning sign on this key: its last press failed. */
  readonly alert?: boolean;
  /** Whether the region has a picture, which moves an unpositioned label. */
  readonly hasPicture?: boolean;
}

/**
 * An opened picture: how many frames it has, how long each lasts, and how to
 * lay one out across a region.
 *
 * A still is a source with exactly one frame — not a separate concept.
 */
export interface FrameSource {
  readonly frameCount: number;
  /** Per-frame durations, in order. Empty for a still. */
  readonly delaysMs: readonly number[];
  /**
   * Lays frame `index` out over the whole region and returns the result.
   *
   * Frames must be requested in ascending order; asking for one already passed
   * is allowed only by reopening the source.
   */
  composeFrame(index: number): Promise<ComposedRegion>;
  /** Releases decoder state. Always called, including on failure. */
  close(): void;
}

export interface OpenRequest {
  /** Absent means a region with no picture: just the background. */
  readonly asset?: AssetRef;
  readonly background?: string;
  readonly geometry: RegionGeometry;
}

export interface ComposerPort {
  open(request: OpenRequest): Promise<FrameSource>;
  /** Cuts one key's share out of a composed region and draws its label on top. */
  cutTile(region: ComposedRegion, request: CutTileRequest): Promise<TileBitmap>;
  /**
   * A finished tile drawn smaller, centred on black.
   *
   * Takes the encoded tile rather than the region behind it, because the
   * picture that produced it may be an animation whose decoder was released
   * long ago — and a key must answer a finger at once, not after a GIF has
   * been replayed to the frame currently on it.
   */
  shrinkTile(tile: Uint8Array, request: ShrinkTileRequest): Promise<TileBitmap>;
}

export interface ShrinkTileRequest {
  readonly width: number;
  readonly height: number;
  /** 0..1 of the original size. */
  readonly scale: number;
}
