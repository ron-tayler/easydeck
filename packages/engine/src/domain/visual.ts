/**
 * What a button looks like.
 *
 * Two shapes live here: the template a profile stores, whose text may contain
 * `{{variable}}` placeholders, and the resolved form produced once those are
 * substituted.
 *
 * `ButtonVisual` is intentionally defined here rather than imported from the
 * renderer zone, so the engine stays free of any rendering dependency. It is
 * structurally compatible with what the renderer accepts, and the daemon —
 * the one place that wires the two together — is where TypeScript will catch
 * any drift between them.
 */

export interface IconSpec {
  /** Path or data URL. Resolved to bytes by whoever rasterizes the visual. */
  readonly source: string;
  readonly fit?: 'contain' | 'cover';
  readonly size?: number;
}

export interface LabelSpec {
  readonly text: string;
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly position?: 'top' | 'center' | 'bottom';
}

/**
 * One key's share of a picture spread across several of them.
 *
 * The key is told which cell of the region it is, not which pixels to cut:
 * scaling a picture across a six-key rectangle and then cropping is the same
 * arithmetic done twice, and doing it once — in the renderer, where the key's
 * real size is known — is the only way the seams line up.
 */
export interface BackdropSlice {
  readonly source: string;
  /** This key's position inside the region, zero-based. */
  readonly col: number;
  readonly row: number;
  /** The size of the whole region, in keys. */
  readonly cols: number;
  readonly rows: number;
  readonly fit?: 'contain' | 'cover';
}

export interface ButtonVisual {
  readonly background?: string;
  readonly cornerRadius?: number;
  /** Drawn behind everything else: it belongs to the region, not the button. */
  readonly backdrop?: BackdropSlice;
  readonly icon?: IconSpec;
  readonly label?: LabelSpec;
}

/** A visual as stored in a profile: label text may contain placeholders. */
export type ButtonVisualTemplate = ButtonVisual;
