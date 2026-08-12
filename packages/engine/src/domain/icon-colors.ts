import { easydeckMetadata } from './icon-params.js';
import type { LocalizedText } from './plugin.js';

/**
 * Icons somebody can recolour.
 *
 * Deliberately not the same feature as the parameters next door, and kept
 * apart on purpose. A parameter exists so a picture can answer to a *variable*
 * — a needle that swings, a bar that fills — and everything about it, the
 * ranges and the units and the bindings, is in service of that. A colour is
 * chosen once, by hand, because somebody wants the mute key red. Running the
 * two through one declaration would have meant explaining ranges to whoever
 * only wanted red.
 *
 * Two layers, and most icons only ever need the first.
 *
 * **`currentColor`** is the whole of the simple case, and it is not our
 * invention: it is how the web has coloured icons since long before us, and how
 * every set worth downloading — Lucide, Feather, Heroicons — already ships. An
 * icon that draws itself in `currentColor` is recolourable here with no
 * metadata, no contract, and no edit. Nobody making icons has to learn anything
 * of ours to get this.
 *
 * **A palette** is for an icon that wants more than one colour: it names its
 * inks in `<metadata>` and reads them with `var()`, and each becomes its own
 * swatch in the editor. A slot may default to `currentColor`, which is how a
 * two-tone icon arrives looking like a one-tone one until somebody splits it.
 *
 * How each gets in differs, and it differs for a measured reason. `currentColor`
 * is resolved by the cascade — librsvg does this correctly in every form it was
 * tested in, including through classes, through nested groups and on strokes —
 * so the artwork is not touched at all, only given a `color` to inherit. `var()`
 * is not supported by any rasterizer in reach, so named slots are substituted
 * into the text, exactly as the parameters are.
 */

/** One named ink an icon offers, read from its `<metadata>`. */
export interface IconColorSlot {
  readonly name: string;
  readonly label?: LocalizedText;
  /**
   * The colour before anyone chooses one.
   *
   * `currentColor` is a legal answer, and a useful one: the slot then follows
   * whatever the icon's main ink is set to, so an icon with three of them is
   * one colour until somebody wants it to be three.
   */
  readonly default?: string;
}

/**
 * Whether the artwork takes a colour from outside itself.
 *
 * Case-insensitive because CSS keywords are: `currentcolor` is as legal as
 * `currentColor`, and some editors normalise one to the other on save.
 */
export function usesCurrentColor(svg: string): boolean {
  return /\bcurrentcolor\b/i.test(svg);
}

/**
 * The inks an icon names, or none.
 *
 * Forgiving in the same way `readIconParams` is: an icon must not fail to load
 * over a typo in a comment. What was wrong is available separately, from
 * `iconPaletteProblem`, for the one place that should say so out loud.
 */
export function readIconPalette(svg: string): IconColorSlot[] {
  const declared = paletteOf(easydeckMetadata(svg));
  if (!declared) return [];

  return declared
    .filter(
      (slot): slot is IconColorSlot =>
        typeof slot === 'object' && slot !== null && typeof (slot as IconColorSlot).name === 'string',
    )
    .filter((slot) => !isReserved(slot.name));
}

/**
 * What is wrong with an icon's palette, when something is.
 *
 * Same bargain as the parameters: reading is forgiving, and the reason is
 * available to be shown. A silent nothing is its own trap — the swatch does not
 * appear, and there is no way to tell "declares no colours" from "declares
 * colours we could not read".
 */
export function iconPaletteProblem(svg: string): string | undefined {
  const text = easydeckMetadata(svg);
  if (text === undefined) return undefined;

  let parsed: { palette?: unknown; params?: unknown };
  try {
    parsed = JSON.parse(text) as { palette?: unknown; params?: unknown };
  } catch {
    // The parameters already report this, and one broken block should not be
    // announced twice in two different words.
    return undefined;
  }

  if (parsed.palette === undefined) return undefined;
  if (!Array.isArray(parsed.palette)) return 'Metadata has a "palette" that is not an array';

  const taken = new Set(paramNames(parsed.params));
  const seen = new Set<string>();

  for (const slot of parsed.palette) {
    if (typeof slot !== 'object' || slot === null || typeof (slot as IconColorSlot).name !== 'string') {
      return 'A palette colour has no "name"';
    }

    const { name } = slot as IconColorSlot;

    // Reserved because it is not a custom property at all: the main ink is the
    // cascade, and a slot claiming that name would be substituted into text
    // that the cascade was about to resolve anyway.
    if (isReserved(name)) return `"${name}" is the icon's own ink and cannot be a palette name`;

    if (seen.has(name)) return `Palette colour "${name}" is declared twice`;
    seen.add(name);

    /*
     * The collision that matters, and the reason this check exists.
     *
     * Both sides write into the same custom property, so a name in both would
     * be set twice from two different controls — a swatch in one panel and a
     * variable binding in another — and whichever ran last would win silently.
     * The author meant one of the two.
     */
    if (taken.has(name)) return `"${name}" is declared as both a palette colour and a parameter`;
  }

  return undefined;
}

/**
 * What each named slot comes to: what was chosen, or what the icon drew itself
 * in.
 *
 * Nothing here consults a variable, which is the whole difference from the
 * parameters: these are constants somebody picked, and they are the same on
 * every repaint.
 */
export function resolveIconColors(
  palette: readonly IconColorSlot[],
  chosen: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const slot of palette) {
    const value = chosen?.[slot.name] ?? slot.default;
    if (value !== undefined) resolved[slot.name] = value;
  }

  return resolved;
}

/**
 * Gives the picture a `color` to inherit, so its `currentColor` resolves.
 *
 * Written as a style attribute rather than a presentation attribute, because an
 * icon is allowed to set `color` on itself in a `<style>` block and CSS beats
 * presentation attributes — the choice made in the editor has to be the one
 * that wins. Nothing else in the markup is touched.
 */
export function withRootColor(svg: string, color: string): string {
  // Anything that could close the attribute or the tag is refused outright
  // rather than escaped: this value came from a colour picker, and a profile
  // carrying something else here is not a colour by any reading.
  if (color === '' || /["'<>]/.test(color)) return svg;

  const root = /<svg\b[^>]*>/i.exec(svg);
  if (!root) return svg;

  const tag = root[0];
  const styled = /(\sstyle\s*=\s*")([^"]*)(")/i.test(tag)
    ? // Appended, so it is the last declaration and wins over anything the icon
      // set for itself in the same attribute.
      tag.replace(/(\sstyle\s*=\s*")([^"]*)(")/i, (_whole, open: string, body: string, close: string) =>
        `${open}${body.trim().replace(/;$/, '')};color:${color}${close}`,
      )
    : tag.replace(/\s*\/?>$/, ` style="color:${color}"$&`);

  return svg.replace(tag, styled);
}

/** The `palette` array of a metadata block, if it has one. */
function paletteOf(text: string | undefined): unknown[] | undefined {
  if (text === undefined) return undefined;

  try {
    const parsed = JSON.parse(text) as { palette?: unknown };
    return Array.isArray(parsed.palette) ? parsed.palette : undefined;
  } catch {
    return undefined;
  }
}

/** Names the parameters have taken, for the collision check. */
function paramNames(params: unknown): string[] {
  if (!Array.isArray(params)) return [];

  return params
    .filter((param): param is { name: string } => typeof param === 'object' && param !== null)
    .map((param) => param.name)
    .filter((name): name is string => typeof name === 'string');
}

function isReserved(name: string): boolean {
  return name.toLowerCase() === 'currentcolor';
}
