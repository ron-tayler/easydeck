/**
 * Declarative description of what a key should look like.
 *
 * This is the contract the engine zone will eventually produce (per button
 * state, after variable substitution). It is deliberately renderer-agnostic:
 * no canvas, no pixels — just intent.
 */
export interface ButtonVisual {
  /** CSS color. Defaults to black. */
  readonly background?: string;
  /** Corner rounding in pixels at 100x100 scale. Defaults to 12. */
  readonly cornerRadius?: number;
  /** Drawn behind everything: this key's share of a multi-key picture. */
  readonly backdrop?: BackdropSlice;
  readonly icon?: IconSpec;
  readonly label?: LabelSpec;
}

/** One key's share of a picture spread across a rectangle of keys. */
export interface BackdropSlice {
  readonly source: Uint8Array | string;
  readonly col: number;
  readonly row: number;
  readonly cols: number;
  readonly rows: number;
  readonly fit?: 'contain' | 'cover';
}

export interface IconSpec {
  /** Encoded image (PNG/JPEG/WebP/AVIF) or a filesystem path to one. */
  readonly source: Uint8Array | string;
  /**
   * How to fit the picture into the key. Defaults to 'cover'.
   *
   * The picture always fills the key edge to edge; there is no inset mode and
   * no size fraction. A key showing a picture shows it whole, and the label
   * goes on top of it.
   */
  readonly fit?: 'contain' | 'cover';
}

export interface LabelSpec {
  readonly text: string;
  /** CSS color. Defaults to white. */
  readonly color?: string;
  /** Defaults to 'sans-serif'. */
  readonly fontFamily?: string;
  /** Starting size in pixels at 100x100 scale; shrinks automatically until
   * the text fits. Defaults to 22. */
  readonly fontSize?: number;
  /** Vertical placement over the picture. Defaults to 'bottom'. */
  readonly position?: 'top' | 'center' | 'bottom';
}
