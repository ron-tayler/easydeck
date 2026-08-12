import { applyIconParams, svgSourceOf, svgTextOf } from './icon-params.js';
import { readIconPalette, resolveIconColors, usesCurrentColor, withRootColor } from './icon-colors.js';

/**
 * Turning a stored icon into something to draw.
 *
 * The one call a renderer needs, and the only place the two things an icon
 * answers to — its parameters and its colours — are put together. They are
 * separate features with separate declarations and separate controls, but they
 * meet in one picture, and this is where.
 *
 * Both surfaces call this over the same icon and get the same text back, which
 * is the whole reason the window and the panel agree about what a key looks
 * like. There was a fortnight when they did not.
 */

/** A stored icon: the artwork, and everything chosen about it. */
export interface DrawableIcon {
  readonly source: string;
  /**
   * What the parameters came to, worked out where the key was resolved.
   *
   * Left beside the icon rather than written into it, because a picture is
   * addressed and cached by its contents and a needle that moved every repaint
   * would defeat the cache it depends on.
   */
  readonly values?: Readonly<Record<string, string>>;
  /** What `currentColor` resolves to — the icon's main ink. */
  readonly color?: string;
  /** What each named slot of the icon's palette was set to. */
  readonly colors?: Readonly<Record<string, string>>;
}

export function drawableIcon(icon: DrawableIcon): string {
  const svg = svgTextOf(icon.source);
  if (svg === undefined) return icon.source;

  // Only when the picture actually reads it. An ink set on an icon that draws
  // itself in fixed colours is a leftover from a picture chosen earlier, and
  // writing it in would say the colour was doing something.
  const ink = icon.color !== undefined && usesCurrentColor(svg) ? icon.color : undefined;

  /*
   * Expanded even when nothing was bound.
   *
   * An icon that uses `var()` and has not been wired up yet still has to be
   * drawable: a browser resolves those from the icon's own `:root` and shows
   * the picture, while librsvg drops the declaration and — for a fill — the
   * shape with it. Without this, dropping a parametric icon on a key gave a
   * preview in the window and a hole on the panel, which is the one
   * disagreement worth going out of the way to avoid.
   *
   * `transform-origin` is here for the same reason: a picture that never uses
   * a variable still turns about the wrong point on the panel unless it is
   * rewritten.
   */
  if (ink === undefined && !svg.includes('var(') && !svg.includes('transform-origin')) {
    return icon.source;
  }

  /*
   * One substitution over one map, rather than a pass each.
   *
   * Two passes would run the `transform-origin` rewrite twice, and a palette
   * colour resolving to `currentColor` would be at the mercy of which pass went
   * first. The parameters are laid over the colours because a name in both is
   * an authoring mistake the palette reports, and the dynamic one is the more
   * surprising to see ignored.
   */
  const substituted = {
    ...resolveIconColors(readIconPalette(svg), icon.colors),
    ...(icon.values ?? {}),
  };

  const drawn = applyIconParams(svg, substituted);
  return svgSourceOf(icon.source, ink === undefined ? drawn : withRootColor(drawn, ink));
}
