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
  /**
   * Defaults to `number`; `color` and `text` are substituted as they are.
   *
   * `readIconParams` normalises what an icon wrote — `string` and `colour` are
   * accepted spellings — so anything downstream sees one of these three.
   */
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
 * The text of the `<metadata id="easydeck">` block, unparsed.
 *
 * Shared with the colour side, which reads a different field of the same block
 * and has to report its own problems with it in its own words. Handing over the
 * text rather than the parsed object is what lets it: a block that will not
 * parse is a different complaint on each side.
 */
export function easydeckMetadata(svg: string): string | undefined {
  const found = METADATA.exec(svg);
  return found?.[1]?.trim();
}

/**
 * What somebody may write for `type`, and what it means here.
 *
 * Three types, and rather more than three words for them. `string` is what
 * anyone who has written JSON schema reaches for, and `colour` is how half the
 * language spells it — including the examples in our own documentation. A
 * declaration refused over spelling shows as a text box that will only accept
 * numbers, which is a long way from the mistake that caused it.
 */
const TYPES: Readonly<Record<string, 'number' | 'color' | 'text'>> = {
  number: 'number',
  num: 'number',
  int: 'number',
  float: 'number',
  color: 'color',
  colour: 'color',
  text: 'text',
  string: 'text',
  str: 'text',
};

/** The declared type, whichever word was used for it. */
function readType(type: unknown): 'number' | 'color' | 'text' | undefined {
  if (typeof type !== 'string') return undefined;
  return TYPES[type.trim().toLowerCase()];
}

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
 * What is wrong with an icon's metadata, when something is.
 *
 * Reading the parameters is deliberately forgiving — an icon must not fail to
 * load over a typo — but a silent nothing is its own trap: the gear does not
 * appear, and there is no way to tell "declares nothing" from "declares
 * something unreadable". So the problem is available to be shown.
 */
export function iconParamsProblem(svg: string): string | undefined {
  const found = METADATA.exec(svg);
  if (!found?.[1]) return undefined;

  try {
    const parsed = JSON.parse(found[1].trim()) as { params?: unknown };

    /*
     * Declaring none is not a fault, and used to be reported as one.
     *
     * This block was once about parameters and nothing else, so a block
     * without them could only mean somebody had misspelled the word. It now
     * carries colours and a placement as well, each independent of the others,
     * and a picture that was merely put somewhere on the key was being
     * announced as broken — with a gear beside it opening a window to say the
     * picture had declared nothing.
     */
    if (parsed.params === undefined) return undefined;
    if (!Array.isArray(parsed.params)) return 'Metadata has a "params" that is not an array';

    const nameless = parsed.params.some(
      (param) => typeof param !== 'object' || param === null || typeof (param as IconParam).name !== 'string',
    );
    if (nameless) return 'A parameter has no "name"';

    // A type nobody recognises falls back to `number`, which shows as a
    // spinner where a text box was wanted — a symptom with no obvious cause
    // unless it is said out loud.
    for (const param of parsed.params as IconParam[]) {
      if (param.type !== undefined && readType(param.type) === undefined) {
        return `Parameter "${param.name}" has an unknown type "${String(param.type)}"; use number, color or text`;
      }
    }

    return undefined;
  } catch (cause) {
    return cause instanceof Error ? cause.message : 'Metadata is not valid JSON';
  }
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

    return parsed.params
      .filter(
        (param): param is IconParam =>
          typeof param === 'object' && param !== null && typeof (param as IconParam).name === 'string',
      )
      // Normalised here rather than at every reader: the settings window, the
      // arithmetic and the panel all ask what type a parameter is, and each of
      // them deciding for itself is three places to disagree.
      .map((param) => {
        const type = readType(param.type);
        return type === undefined ? omitType(param) : { ...param, type };
      });
  } catch {
    return [];
  }
}

/** A parameter whose declared type meant nothing, left as the default. */
function omitType(param: IconParam): IconParam {
  const { type: _unreadable, ...rest } = param;
  return rest;
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

  // Everything is coerced: `"from": "0"` is what somebody writes when they
  // are typing JSON by hand, and treating it as a different kind of zero
  // would produce NaN and a picture that silently never moves.
  const inFrom = Number(binding.from ?? 0);
  const inTo = Number(binding.to ?? 100);
  const outFrom = Number(param.from ?? 0);
  const outTo = Number(param.to ?? 1);

  if (!Number.isFinite(inFrom) || !Number.isFinite(inTo)) return outFrom;
  if (!Number.isFinite(outFrom) || !Number.isFinite(outTo)) return 0;

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
/**
 * Writes `transform-origin` into the transform itself.
 *
 * The second thing librsvg does not do, and the only one left: it ignores the
 * property outright and turns everything about `(0, 0)`, so a needle pinned to
 * the corner of its dial swings off the picture instead of around the pin.
 * Measured, not assumed — a gauge that worked in the window drew an empty dial
 * on the panel.
 *
 * The rewrite is the identity every graphics text gives for rotating about a
 * point: move the origin there, transform, move it back. Both engines
 * understand that, and the declaration is removed afterwards so a browser
 * given this same text does not apply the offset a second time.
 *
 * A transform with no origin declared is left alone: both engines already
 * agree that it turns about `(0, 0)`, which is also what the browser does —
 * checked rather than assumed, since the CSS default outside SVG is the
 * centre and it would have been reasonable to expect that here.
 */
export function expandTransformOrigin(svg: string): string {
  if (!svg.includes('transform-origin')) return svg;

  const view = viewBoxOf(svg);

  // Rule bodies inside <style>, and the style attribute of any one element.
  return svg
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (whole, body: string) =>
      whole.replace(body, body.replace(/\{([^{}]*)\}/g, (block, declarations: string) =>
        block.replace(declarations, rewriteOrigin(declarations, view)),
      )),
    )
    .replace(/style\s*=\s*"([^"]*)"/gi, (whole, declarations: string) =>
      whole.replace(declarations, rewriteOrigin(declarations, view)),
    );
}

/** The picture's own coordinate system, which is what an origin is measured in. */
interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function viewBoxOf(svg: string): ViewBox | undefined {
  const found = /viewBox\s*=\s*["']\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)/i.exec(svg);
  if (!found) return undefined;

  return {
    x: Number(found[1]),
    y: Number(found[2]),
    width: Number(found[3]),
    height: Number(found[4]),
  };
}

/** One block of declarations, with its transform wrapped around its origin. */
function rewriteOrigin(declarations: string, view: ViewBox | undefined): string {
  const origin = /transform-origin\s*:\s*([^;}]+)/i.exec(declarations);
  if (!origin?.[1]) return declarations;

  // `transform-origin` starts with `transform` but is not followed by a colon,
  // so this finds the transform itself wherever the two are written.
  if (!/transform\s*:/i.test(declarations)) return declarations;

  const point = originPoint(origin[1], view);
  // Something we cannot work out — `em`, a third value — is left exactly as it
  // was. A picture drawn slightly wrong beats one not drawn at all.
  if (!point) return declarations;

  return declarations
    .replace(
      /transform\s*:\s*([^;}]+)/i,
      (_whole, value: string) =>
        `transform: translate(${point.x}px, ${point.y}px) ${value.trim()} ` +
        `translate(${-point.x}px, ${-point.y}px)`,
    )
    .replace(/transform-origin\s*:\s*[^;}]+;?/i, '');
}

/** Where a keyword sits along its axis, as the fraction CSS says it is. */
const KEYWORDS: Readonly<Record<string, number>> = {
  left: 0,
  top: 0,
  center: 0.5,
  right: 1,
  bottom: 1,
};

const VERTICAL = new Set(['top', 'bottom']);
const HORIZONTAL = new Set(['left', 'right']);

/**
 * What `transform-origin: 50% 50%` and its relatives come to.
 *
 * Percentages and keywords are measured against the **viewBox**, not against
 * the shape's own box — which is the one surprise here, and was settled by
 * measuring a browser rather than by reading: `50% 50%`, `center` and a length
 * at the viewBox centre all rotate a rectangle to exactly the same place.
 */
function originPoint(value: string, view: ViewBox | undefined): { x: number; y: number } | undefined {
  const parts = value.trim().split(/\s+/);
  if (parts.length > 2) return undefined;

  // A single value sets x and centres y, and two keywords may be written
  // either way round — `top left` means the same as `left top`.
  const [first, second = '50%'] = parts as [string, string?];
  const flipped = VERTICAL.has(first.toLowerCase()) || HORIZONTAL.has(second.toLowerCase());
  const [alongX, alongY] = flipped ? [second, first] : [first, second];

  const x = resolve(alongX, view?.x, view?.width);
  const y = resolve(alongY, view?.y, view?.height);
  if (x === undefined || y === undefined) return undefined;

  // Two decimals: an icon is drawn at 128 pixels and cannot show a third.
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function resolve(token: string, start: number | undefined, size: number | undefined): number | undefined {
  const keyword = KEYWORDS[token.toLowerCase()];
  const fraction = keyword ?? (/^-?[\d.]+%$/.test(token) ? Number(token.slice(0, -1)) / 100 : undefined);

  if (fraction !== undefined) {
    // A picture with no viewBox has no proportions to take a fraction of.
    if (start === undefined || size === undefined) return undefined;
    return start + fraction * size;
  }

  const length = /^(-?[\d.]+)(px)?$/.exec(token);
  return length ? Number(length[1]) : undefined;
}

export function applyIconParams(svg: string, values: Readonly<Record<string, string>>): string {
  let out = svg;

  for (const [name, value] of Object.entries(values)) {
    const declaration = new RegExp(`(--${escapeName(name)}\s*:)([^;}]*)`, 'g');
    out = out.replace(declaration, `$1 ${value}`);
  }

  /*
   * Everything the icon declares for itself, underneath what we were given.
   *
   * A picture may use properties it never offered as parameters — a colour it
   * always draws in, a corner it never varies — and those have to be expanded
   * too, because librsvg does not merely ignore an unresolved `var()`: it
   * throws the declaration away, and with a fill that means the shape is not
   * drawn at all. A browser resolves them from `:root` and shows the picture;
   * the panel would show a hole, which is the one disagreement this whole
   * mechanism exists to prevent.
   */
  const known = { ...declaredProperties(out), ...values };

  // Expanded after the declarations, so a property that reads another one —
  // rare, but legal — sees the value rather than the name.
  out = out.replace(
    /var\(\s*--([A-Za-z0-9_-]+)\s*(?:,\s*([^)]*))?\)/g,
    (whole, name: string, fallback: string | undefined) => {
      const value = known[name];
      if (value !== undefined) return value;
      return fallback !== undefined ? fallback.trim() : whole;
    },
  );

  // After the substitution, so a rotation fed by a variable is wrapped around
  // its origin the same way a fixed one is.
  return expandTransformOrigin(out);
}

/**
 * Custom properties the picture sets on itself, wherever it sets them.
 *
 * Read out of the text rather than through a stylesheet model: this is a
 * substitution over markup, and something that started parsing CSS properly
 * would have to keep doing it for ever. Declarations in the icons this is for
 * are simple — a `:root` block, occasionally a class — and the last one
 * written wins, which is what the cascade does at equal specificity anyway.
 */
function declaredProperties(svg: string): Record<string, string> {
  const declared: Record<string, string> = {};

  for (const match of svg.matchAll(/--([A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g)) {
    const name = match[1];
    const value = match[2];
    if (name && value) declared[name] = value.trim();
  }

  return declared;
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
