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

import type { BackgroundSpec } from './background.js';
import type { IconBinding } from './icon-params.js';
import type { SurfaceSpec } from './surface-spec.js';

export interface IconSpec {
  /**
   * Path or data URL. Resolved to bytes by whoever rasterizes the visual.
   *
   * The picture always fills the key edge to edge, cropped to do it — a single
   * key included — and the label is drawn over it. There is no fit setting:
   * one that changed how a picture met the key's edge was offered on every
   * icon, where what people wanted was for the picture to fill the key.
   */
  readonly source: string;
  /**
   * The icon's main ink: what its `currentColor` resolves to.
   *
   * Absent on a picture that draws itself in fixed colours, and on every
   * photograph. Applied by giving the artwork a `color` to inherit rather than
   * by rewriting it — see `icon-colors.ts` for why that is the whole of it.
   */
  readonly color?: string;
  /**
   * What each colour the icon *names* was set to, where it names any.
   *
   * Rare, and absent from almost every icon: one ink is what a glyph needs.
   * This is for a picture drawn in two or three of them, which says so in its
   * `<metadata>` and reads them back with `var()`.
   */
  readonly colors?: Readonly<Record<string, string>>;
  /**
   * What feeds each parameter the icon declares, where any does.
   *
   * A constant is a value somebody chose once; an object binds a variable, so
   * the picture answers to it. Absent on every ordinary icon, which is most
   * of them — see `icon-params.ts` for what the icon says about itself.
   */
  readonly params?: Readonly<Record<string, IconBinding>>;
  /**
   * What those parameters came to, worked out when the key was resolved.
   *
   * Present on a resolved visual, never in a profile. The picture itself is
   * left exactly as it was: whoever draws it — the renderer here, a browser
   * over there — substitutes these into a copy. That is what keeps the icon
   * cacheable while the needle moves, since the thing being addressed and
   * cached never changes.
   */
  readonly values?: Readonly<Record<string, string>>;
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
}

export interface ButtonVisual {
  /**
   * A colour, or a colour with a gradient over it.
   *
   * Still a plain string on almost every key, and on every key written before
   * gradients existed — see `background.ts` for why the simple form was kept
   * rather than wrapped.
   */
  readonly background?: BackgroundSpec;
  readonly cornerRadius?: number;
  /** Drawn behind everything else: it belongs to the region, not the button. */
  readonly backdrop?: BackdropSlice;
  readonly icon?: IconSpec;
  /**
   * A picture drawn by a plugin rather than stored in the profile.
   *
   * Takes precedence over `icon` when it answers, and falls back to it when it
   * does not — so a key can carry a still to show while nothing is playing,
   * and the two need no rule between them beyond "the live one first".
   *
   * On the state rather than the button, like everything else here: "album art
   * while it plays, a plain icon while it is paused" is then two states, which
   * is what states are for.
   */
  readonly surface?: SurfaceSpec;
  readonly label?: LabelSpec;
  /**
   * The last press of this key ended in an error, and it says so.
   *
   * Not part of what a profile stores — it is set while drawing, and cleared a
   * few seconds later. A deck has nowhere to put a message: on the D6 the keys
   * are the entire display, so the key that failed is where the failure has to
   * appear.
   */
  readonly alert?: boolean;
}

/** A visual as stored in a profile: label text may contain placeholders. */
export type ButtonVisualTemplate = ButtonVisual;
