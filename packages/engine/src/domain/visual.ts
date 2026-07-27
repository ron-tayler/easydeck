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

export interface ButtonVisual {
  readonly background?: string;
  readonly cornerRadius?: number;
  readonly icon?: IconSpec;
  readonly label?: LabelSpec;
}

/** A visual as stored in a profile: label text may contain placeholders. */
export type ButtonVisualTemplate = ButtonVisual;
