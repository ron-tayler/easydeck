/**
 * The panel as a piece of geometry: how many keys, how big each one is, and
 * how far apart they sit.
 *
 * Everything the compositor needs to lay a picture out across several keys,
 * and nothing about HID, JPEG or the engine's idea of a button. The device
 * zone owns the same numbers in its own shape; whoever wires the two together
 * translates once, here, rather than everywhere a size is needed.
 */
export interface PanelFormat {
  readonly rows: number;
  readonly cols: number;
  /** Pixel size of one key display. */
  readonly tileWidth: number;
  readonly tileHeight: number;
  /**
   * Space between two neighbouring displays, in the same pixels as the tiles.
   *
   * Only a picture stretched across several keys cares, and it must be
   * *skipped* rather than squeezed: what falls between two displays is behind
   * the bezel, and laying the picture out over the visible strips alone
   * repeats a sliver of it at every seam.
   */
  readonly gap: number;
  /** How the panel is mounted; tiles are pre-rotated by this before encoding. */
  readonly rotationDegrees: 0 | 90 | 180 | 270;
  /** Hard firmware limit for one encoded tile. */
  readonly maxTileBytes: number;
}

export interface RegionGeometry {
  /** Size of the whole region in keys. */
  readonly cols: number;
  readonly rows: number;
  /** Size of the whole region in pixels, gaps included. */
  readonly width: number;
  readonly height: number;
}

export function keyCount(format: PanelFormat): number {
  return format.rows * format.cols;
}

export function columnOf(format: PanelFormat, key: number): number {
  return key % format.cols;
}

export function rowOf(format: PanelFormat, key: number): number {
  return Math.floor(key / format.cols);
}

/**
 * The pixel size a region occupies across the panel, gaps included.
 *
 * The picture is laid out over *this*, not over the sum of the visible
 * strips — see `gap`.
 */
export function regionGeometry(format: PanelFormat, cols: number, rows: number): RegionGeometry {
  return {
    cols,
    rows,
    width: format.tileWidth * cols + format.gap * (cols - 1),
    height: format.tileHeight * rows + format.gap * (rows - 1),
  };
}

/** Where this key's tile starts inside its composed region. */
export function tileOrigin(
  format: PanelFormat,
  col: number,
  row: number,
): { readonly x: number; readonly y: number } {
  return {
    x: col * (format.tileWidth + format.gap),
    y: row * (format.tileHeight + format.gap),
  };
}
