import type { LocalizedText } from './plugin.js';
import type { VariableValue } from './variables.js';

/**
 * Icons that answer to a variable.
 *
 * A key can show a number; this is how it points at one — a needle that swings
 * with the processor, a bar that fills with the disk. The picture is the same
 * picture every time and one thing about it moves.
 *
 * The whole mechanism is substitution over text. An icon declares what may be
 * changed about it, a key says which variable feeds each of those, and the
 * host does the arithmetic and writes the answers into the SVG's own custom
 * properties. No rasterizer in reach supports `var()` — not resvg, not
 * librsvg — so expanding them here is what makes the panel agree with the
 * browser, where the very same text is substituted before it is shown.
 *
 * Deliberately not an expression language, for the same reason templates are
 * not: profiles are edited by people who are not programmers. A parameter has
 * a range, a variable has a range, and the mapping between them is arithmetic
 * nobody has to write.
 */

/** What an icon says may be changed about it, read from its `<metadata>`. */
export interface IconParam {
  readonly name: string;
  readonly label?: LocalizedText;
  readonly description?: LocalizedText;
  /** Defaults to `number`; `color` and `text` are substituted as they are. */
  readonly type?: 'number' | 'color' | 'text';
  /** For `number`: the range this parameter means, in its own units. */
  readonly from?: number;
  readonly to?: number;
  /**
   * What the number is measured in: `deg`, `px`, `%`, or nothing at all.
   *
   * Appended to whatever the arithmetic produces, because CSS is particular
   * about it — `rotate(35)` is not an angle and `rotate(35deg)` is. A ratio
   * for `scaleX` has no unit and says so by leaving this out.
   */
  readonly unit?: string;
  /** What the icon looks like before it is wired to anything. */
  readonly default?: string | number;
}

/**
 * How one parameter is fed.
 *
 * A plain value is a constant — the colour somebody picked, once. An object
 * binds a variable: with `from`/`to` it is a number being mapped onto the
 * parameter's own range, with `map` it is a value being looked up, and with
 * neither it is passed through as text.
 */
export type IconBinding =
  | string
  | number
  | boolean
  | {
      readonly variable: string;
      /** The range the *variable* moves in, mapped onto the parameter's. */
      readonly from?: number;
      readonly to?: number;
      /** For enums, booleans and strings: this value means that one. */
      readonly map?: Readonly<Record<string, string>>;
    };

const METADATA = /<metadata\b[^>]*\bid=["']easydeck["'][^>]*>([\s\S]*?)<\/metadata>/i;

/**
 * The text of an SVG, whether it arrived as one or as a data URL.
 *
 * Icons live in profiles as `data:image/svg+xml;base64,…`, because a profile
 * is one JSON document and a picture has to fit inside it. Everything here
 * works on the markup, so this is where the two meet.
 *
 * Returns undefined for anything that is not an SVG — a PNG, a path on disk —
 * which is how the whole mechanism stays absent from ordinary icons.
 */
export function svgTextOf(source: string): string | undefined {
  if (source.startsWith('<')) return source;
  if (!source.startsWith('data:image/svg+xml')) return undefined;

  const comma = source.indexOf(',');
  if (comma < 0) return undefined;

  const body = source.slice(comma + 1);
  const header = source.slice(0, comma);

  try {
    if (header.includes(';base64')) return fromBase64(body);
    return decodeURIComponent(body);
  } catch {
    return undefined;
  }
}

/*
 * `atob`/`btoa` rather than Buffer, because this runs in both places.
 *
 * The panel substitutes before rasterizing and a browser substitutes before
 * showing, over the same text with the same code — which is the whole reason
 * the two agree about what an icon looks like. A Node-only call here would
 * have split that in half.
 *
 * Both go through UTF-8 explicitly: base64 carries bytes, and an icon written
 * by somebody who names their layers in Russian has plenty that are not
 * ASCII.
 */
function fromBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Puts markup back into the shape its source came in. */
export function svgSourceOf(source: string, svg: string): string {
  if (source.startsWith('<')) return svg;
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

/**
 * Substitutes into an icon of any shape, and leaves anything else alone.
 *
 * The one call a renderer needs: hand it what the profile stored and what the
 * key resolved, get back something to draw.
 */
export function drawableIcon(
  source: string,
  values: Readonly<Record<string, string>> | undefined,
): string {
  if (!values || Object.keys(values).length === 0) return source;

  const svg = svgTextOf(source);
  if (svg === undefined) return source;

  return svgSourceOf(source, applyIconParams(svg, values));
}


/**
 * The parameters an icon declares, or none.
 *
 * `<metadata>` is a standard SVG element every rasterizer ignores, so an icon
 * carrying this is still an ordinary SVG that opens in an editor and works in
 * a browser. A file that declares nothing — or declares nonsense — simply has
 * no parameters, because an icon failing to load over a typo in a comment
 * would be a poor trade.
 */
export function readIconParams(svg: string): IconParam[] {
  const found = METADATA.exec(svg);
  if (!found?.[1]) return [];

  try {
    const parsed = JSON.parse(found[1].trim()) as { params?: unknown };
    if (!Array.isArray(parsed.params)) return [];

    return parsed.params.filter(
      (param): param is IconParam =>
        typeof param === 'object' && param !== null && typeof (param as IconParam).name === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * What each parameter comes to, given the bindings and the current values.
 *
 * Everything ends up a string, because what it becomes is a CSS custom
 * property — `--angle: 35deg`. Numbers carry the unit the icon asked for
 * through its own default, which is how `0deg` stays an angle and `0.5` stays
 * a ratio.
 */
export function resolveIconParams(
  params: readonly IconParam[],
  bindings: Readonly<Record<string, IconBinding>> | undefined,
  variables: Readonly<Record<string, VariableValue>>,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const param of params) {
    const binding = bindings?.[param.name];

    if (binding === undefined) {
      if (param.default !== undefined) resolved[param.name] = withUnit(param);
      continue;
    }

    if (typeof binding !== 'object') {
      resolved[param.name] = String(binding);
      continue;
    }

    const value = variables[binding.variable];
    if (value === undefined) {
      if (param.default !== undefined) resolved[param.name] = withUnit(param);
      continue;
    }

    if (binding.map) {
      const mapped = binding.map[String(value)];
      if (mapped !== undefined) resolved[param.name] = mapped;
      else if (param.default !== undefined) resolved[param.name] = withUnit(param);
      continue;
    }

    if (param.type === 'color' || param.type === 'text') {
      resolved[param.name] = String(value);
      continue;
    }

    resolved[param.name] = `${scale(Number(value), binding, param)}${param.unit ?? ''}`;
  }

  return resolved;
}

/**
 * The default with its unit, unless the icon already wrote one.
 *
 * `"default": 0` and `"unit": "deg"` mean `0deg`, and `"default": "0deg"`
 * means the same — an icon may say it either way, and neither should come out
 * as `0degdeg`.
 */
function withUnit(param: IconParam): string {
  const value = String(param.default);
  if (typeof param.default !== 'number' || !param.unit) return value;
  return `${value}${param.unit}`;
}

/**
 * Maps a variable's range onto the parameter's, clamped at both ends.
 *
 * Clamped because the ends are what a picture is drawn against: a needle told
 * to point at 130% of its dial is a needle drawn outside the dial, and the
 * user who set the range meant "this is the whole of it".
 */
function scale(value: number, binding: { from?: number; to?: number }, param: IconParam): number {
  if (!Number.isFinite(value)) return Number(param.default ?? 0);

  const inFrom = binding.from ?? 0;
  const inTo = binding.to ?? 100;
  const outFrom = param.from ?? 0;
  const outTo = param.to ?? 1;

  if (inTo === inFrom) return outFrom;

  const ratio = Math.min(1, Math.max(0, (value - inFrom) / (inTo - inFrom)));
  const scaled = outFrom + ratio * (outTo - outFrom);

  // Two decimals: an SVG drawn at 128 pixels cannot show a third, and a value
  // that changes below what is visible is a picture redrawn for nothing.
  return Math.round(scaled * 100) / 100;
}

/**
 * Writes the values into the SVG and expands the `var()` that read them.
 *
 * Two passes, because an icon may use its properties either way round: the
 * declarations in `:root` are replaced so an editor still shows sensible
 * defaults, and every `var(--name)` elsewhere is substituted so a rasterizer
 * that has never heard of custom properties draws the same picture a browser
 * does.
 *
 * Anything unresolved keeps its fallback or its declared default, so a
 * half-configured icon is still a picture rather than a blank.
 */
export function applyIconParams(svg: string, values: Readonly<Record<string, string>>): string {
  let out = svg;

  for (const [name, value] of Object.entries(values)) {
    const declaration = new RegExp(`(--${escapeName(name)}\\s*:)([^;}]*)`, 'g');
    out = out.replace(declaration, `$1 ${value}`);
  }

  // Expanded after the declarations, so a property that reads another one —
  // rare, but legal — sees the value rather than the name.
  out = out.replace(
    /var\(\s*--([A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)/g,
    (whole, name: string, fallback: string | undefined) => {
      const value = values[name];
      if (value !== undefined) return value;
      return fallback !== undefined ? fallback.trim() : whole;
    },
  );

  return out;
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
