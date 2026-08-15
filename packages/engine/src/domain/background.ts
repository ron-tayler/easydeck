/**
 * What a key has behind everything else.
 *
 * A background used to be a colour, and most of them still are: a profile that
 * says `#1f4e79` keeps saying it, and every file written before this one is
 * read without a migration. The object form is what a colour turns into once
 * somebody wants light on it — a flat colour underneath, a ramp across it, and
 * any number of soft spots dropped on top.
 *
 * The arithmetic lives here rather than in either surface that draws it. The
 * web preview builds a CSS `background` and the panel paints onto a canvas, and
 * the two have to agree pixel for pixel: a preview that is a shade off is worse
 * than no preview, because it is believed. So the shapes — where a gradient's
 * line runs, how far a spot reaches, how it fades — are decided once, in the
 * one zone both of them already depend on.
 *
 * The spot's reach is a fraction of the box rather than a radius in pixels, and
 * it is an ellipse rather than a circle for the same reason: CSS can only size
 * an ellipse in percentages, and on a key — which is square — an ellipse sized
 * that way *is* a circle. What it costs is a stretched spot on a picture spread
 * across a row of keys, and what it buys is that the browser and the renderer
 * are drawing the same thing rather than two things that usually look alike.
 */

/** A flat colour, or a colour with something happening on it. */
export type BackgroundSpec = string | GradientBackground;

export interface GradientBackground {
  /** The flat colour under everything. Any CSS colour; hex in practice. */
  readonly base: string;
  /** A ramp straight across the key. Absent when there is only base and spots. */
  readonly linear?: LinearGradient;
  /**
   * Circles of light on top of all that, each fading out to nothing.
   *
   * Drawn in order, over the ramp. This is the part no colour picker offers:
   * two of them in opposite corners is most of what a modern key looks like,
   * and neither a flat fill nor a single ramp can say it.
   */
  readonly spots?: readonly GradientSpot[];
}

export interface LinearGradient {
  /**
   * Degrees clockwise from straight up, exactly as CSS counts them: `0` runs
   * bottom to top, `90` left to right.
   */
  readonly angle: number;
  /** Two or more, each at its own place along the line. */
  readonly stops: readonly GradientStop[];
}

export interface GradientStop {
  /** `#rrggbb` or `#rrggbbaa`. */
  readonly color: string;
  /** Where it sits along the line, 0 at the start and 1 at the end. */
  readonly at: number;
}

export interface GradientSpot {
  /** `#rrggbb` or `#rrggbbaa` — the colour at the very centre. */
  readonly color: string;
  /** The centre, 0..1 across the key from the top-left corner. */
  readonly x: number;
  readonly y: number;
  /** How far the light reaches, as a fraction of the key. 0.5 is half of it. */
  readonly radius: number;
}

/** What a key falls back to when nothing was ever chosen. */
export const DEFAULT_BACKGROUND = '#111318';

/** The colour under everything, whichever form the background takes. */
export function backgroundBase(spec: BackgroundSpec | undefined): string | undefined {
  if (spec === undefined) return undefined;
  return typeof spec === 'string' ? spec : spec.base;
}

/** Whether anything is drawn over the flat colour. */
export function hasGradient(spec: BackgroundSpec | undefined): spec is GradientBackground {
  if (spec === undefined || typeof spec === 'string') return false;
  return Boolean(spec.linear) || (spec.spots?.length ?? 0) > 0;
}

/**
 * The same background with a different colour underneath.
 *
 * The one place the two forms meet: the colour button beside the gradient one
 * edits the base whether or not a gradient is on the key, so it has to be able
 * to set it without knowing which of the two it is holding.
 */
export function withBase(spec: BackgroundSpec | undefined, base: string): BackgroundSpec {
  return spec === undefined || typeof spec === 'string' ? base : { ...spec, base };
}

/**
 * The gradient, dropped: what is left is the colour it stood on.
 *
 * A background that has nothing over it goes back to being a plain string, so
 * a key someone experimented with and then cleared is stored the way it would
 * have been if they never had.
 */
export function withoutGradient(spec: BackgroundSpec | undefined): string | undefined {
  return backgroundBase(spec);
}

// --- colours -------------------------------------------------------------

/** Three, four, six or eight hex digits, with or without the `#`. */
const HEX = /^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * A stop colour, read.
 *
 * Only hex is understood, because only hex is ever written here: every stop and
 * every spot comes from the colour picker, which speaks in six or eight digits.
 * Anything else is taken for opaque black rather than refused — a background is
 * not worth an error dialog, and a black key says plainly that something is
 * wrong with what it was given.
 */
function readColor(colour: string): Rgba {
  const trimmed = colour.trim();
  if (!HEX.test(trimmed)) return { r: 0, g: 0, b: 0, a: 1 };

  const digits = trimmed.replace('#', '').toLowerCase();
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  const at = (index: number): number => Number.parseInt(full.slice(index, index + 2), 16);

  return {
    r: at(0),
    g: at(2),
    b: at(4),
    a: full.length === 8 ? at(6) / 255 : 1,
  };
}

/**
 * `rgba(...)` rather than eight hex digits, and always spelled out in full.
 *
 * Both surfaces accept both forms, but a gradient fading to `transparent` is
 * the one mistake this file exists to prevent: `transparent` is transparent
 * *black*, so a red spot fading to it fades through grey and leaves a dirty
 * ring. Every stop this returns keeps the spot's own colour and moves only the
 * alpha, which is what makes the light look like light.
 */
export function colorAt(colour: string, opacity: number): string {
  const { r, g, b, a } = readColor(colour);
  const alpha = Math.max(0, Math.min(1, a * opacity));
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

/**
 * Black on a light colour, white on a dark one.
 *
 * For the controls that *are* their own swatch: a button showing the colour it
 * sets has to stay readable over every colour it can be asked to show. The
 * weights are the usual ones for perceived brightness — green counts for more
 * than half of it, blue for almost nothing.
 */
export function contrastInk(colour: string): string {
  const { r, g, b } = readColor(colour);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#000000' : '#ffffff';
}

/** How much of a colour comes through, 0 to 1. Opaque unless it says otherwise. */
export function opacityOf(colour: string): number {
  return readColor(colour).a;
}

/**
 * The same colour, seen through more or less of it.
 *
 * Written back as eight hex digits rather than `rgba(...)`, because this is
 * what gets stored: a profile full of `rgba(255, 255, 255, 0.6)` would be a
 * profile whose colours no longer match the ones beside them, and the colour
 * picker speaks hex.
 */
export function withOpacity(colour: string, opacity: number): string {
  const { r, g, b } = readColor(colour);
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  const pair = (value: number): string => value.toString(16).padStart(2, '0');

  return `#${pair(r)}${pair(g)}${pair(b)}${pair(alpha)}`;
}

/**
 * A colour moved towards white or, with a negative amount, towards black.
 *
 * Only ever used to propose something: the ramp a key gets when somebody first
 * asks for a gradient starts from a lighter version of the colour already
 * there, so the first thing they see is their own key with light on it rather
 * than two arbitrary colours they now have to fix.
 */
export function shade(colour: string, amount: number): string {
  const { r, g, b, a } = readColor(colour);
  const towards = amount >= 0 ? 255 : 0;
  const weight = Math.min(1, Math.abs(amount));

  const mix = (channel: number): number => Math.round(channel + (towards - channel) * weight);
  const pair = (value: number): string => value.toString(16).padStart(2, '0');

  const opaque = `#${pair(mix(r))}${pair(mix(g))}${pair(mix(b))}`;
  return a === 1 ? opaque : withOpacity(opaque, a);
}

/**
 * The colour a ramp has reached at a given point along it.
 *
 * What a click on the middle of the gradient bar has to produce: a stop added
 * there is expected to leave the picture exactly as it was, and only then be
 * dragged or recoloured. One that arrived black would undo the gradient the
 * moment it appeared.
 */
export function sampleStops(stops: readonly GradientStop[], at: number): string {
  const ordered = orderedStops(stops);
  if (ordered.length === 0) return '#ffffff';

  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  if (at <= first.at) return first.color;
  if (at >= last.at) return last.color;

  for (let index = 1; index < ordered.length; index++) {
    const right = ordered[index]!;
    if (right.at < at) continue;

    const left = ordered[index - 1]!;
    const span = right.at - left.at;
    const along = span === 0 ? 0 : (at - left.at) / span;
    return mixColors(left.color, right.color, along);
  }

  return last.color;
}

/** Two colours blended, `along` of the way from the first to the second. */
export function mixColors(one: string, other: string, along: number): string {
  const from = readColor(one);
  const to = readColor(other);
  const weight = Math.min(1, Math.max(0, along));

  const mix = (a: number, b: number): number => Math.round(a + (b - a) * weight);
  const pair = (value: number): string => value.toString(16).padStart(2, '0');

  const opaque = `#${pair(mix(from.r, to.r))}${pair(mix(from.g, to.g))}${pair(mix(from.b, to.b))}`;
  const alpha = from.a + (to.a - from.a) * weight;

  return alpha === 1 ? opaque : withOpacity(opaque, alpha);
}

/**
 * How a spot fades: full in the middle, gone at its edge, and not in a straight
 * line between the two.
 *
 * A single ramp from the colour to nothing reads as a disc with a visible rim.
 * Bending it — most of the fall in the first half of the radius — is what turns
 * the same two colours into a glow. Shared by both surfaces so the rim is in
 * the same place on the key as it is in the preview.
 */
export const SPOT_FALLOFF: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.35, 0.72],
  [0.65, 0.3],
  [1, 0],
];

// --- geometry ------------------------------------------------------------

export interface GradientLine {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * Where a linear gradient's line runs across a box of this size.
 *
 * CSS's own definition, reproduced: the line passes through the centre at the
 * given angle, and is exactly long enough that its ends sit on the corners
 * nearest them. Anything shorter would leave the corners a flat colour; the
 * browser draws it this way, so the canvas has to as well.
 */
export function gradientLine(angle: number, width: number, height: number): GradientLine {
  const radians = ((angle % 360) * Math.PI) / 180;
  // Up is negative on both surfaces, so 0° points at the top of the box.
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);

  const length = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;

  return {
    x0: cx - (dx * length) / 2,
    y0: cy - (dy * length) / 2,
    x1: cx + (dx * length) / 2,
    y1: cy + (dy * length) / 2,
  };
}

// --- the web's form ------------------------------------------------------

/**
 * The whole background as one CSS `background` value.
 *
 * Layers first and the flat colour last, which is the order the shorthand
 * wants: what is written first is drawn on top. Spots come before the ramp for
 * the same reason they are painted after it on the canvas.
 */
export function backgroundCss(
  spec: BackgroundSpec | undefined,
  fallback: string = DEFAULT_BACKGROUND,
): string {
  if (spec === undefined) return fallback;
  if (typeof spec === 'string') return spec;

  const layers = [
    ...(spec.spots ?? []).map(spotCss),
    ...(spec.linear ? [linearCss(spec.linear)] : []),
  ];

  return layers.length > 0 ? `${layers.join(', ')}, ${spec.base}` : spec.base;
}

/**
 * The ramp on its own, as one CSS layer.
 *
 * Wanted by the editor, which draws the same ramp flat on a bar — turned to run
 * left to right, since a bar has only one direction — while the key beside it
 * shows the angle. The same function draws both, so the bar cannot end up
 * showing a ramp the key does not have.
 */
export function linearGradientCss(linear: LinearGradient): string {
  return linearCss(linear);
}

function linearCss(linear: LinearGradient): string {
  const stops = orderedStops(linear.stops)
    .map((stop) => `${colorAt(stop.color, 1)} ${percent(stop.at)}`)
    .join(', ');

  return `linear-gradient(${round(linear.angle)}deg, ${stops})`;
}

function spotCss(spot: GradientSpot): string {
  const stops = SPOT_FALLOFF.map(
    ([at, opacity]) => `${colorAt(spot.color, opacity)} ${percent(at)}`,
  ).join(', ');

  const size = `${percent(spot.radius)} ${percent(spot.radius)}`;
  return `radial-gradient(ellipse ${size} at ${percent(spot.x)} ${percent(spot.y)}, ${stops})`;
}

const percent = (value: number): string => `${round(value * 100)}%`;

const round = (value: number): number => Math.round(value * 100) / 100;

/**
 * Stops in the order the line meets them.
 *
 * Dragging one stop past another is how anybody rearranges a gradient, and both
 * surfaces reject a list that goes backwards — CSS by clamping it, the canvas by
 * throwing. Sorting on the way out means the editor never has to police it.
 */
export function orderedStops(stops: readonly GradientStop[]): readonly GradientStop[] {
  return [...stops].sort((one, other) => one.at - other.at);
}

// --- identity ------------------------------------------------------------

/**
 * A short, stable string for "is this the same background?".
 *
 * Two of these are compared on every repaint and one of them decides whether a
 * cached tile is reused, so it has to answer the same way for two backgrounds
 * that draw the same — which `JSON.stringify` does not, since it follows the
 * order the fields happened to be written in. Every field is named here
 * instead, in one fixed order.
 */
export function backgroundSignature(spec: BackgroundSpec | undefined): string {
  if (spec === undefined) return '';
  if (typeof spec === 'string') return spec;

  const linear = spec.linear
    ? `${round(spec.linear.angle)}:${orderedStops(spec.linear.stops)
        .map((stop) => `${stop.color}@${round(stop.at)}`)
        .join(';')}`
    : '';

  const spots = (spec.spots ?? [])
    .map((spot) => `${spot.color}@${round(spot.x)},${round(spot.y)}~${round(spot.radius)}`)
    .join(';');

  return `${spec.base}|${linear}|${spots}`;
}
