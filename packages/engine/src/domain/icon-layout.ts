import { easydeckMetadata, expandTransformOrigin, readIconParams, svgTextOf } from './icon-params.js';
import type { IconParam } from './icon-params.js';
import { readIconPalette } from './icon-colors.js';
import type { IconColorSlot } from './icon-colors.js';
import type { LocalizedText } from './plugin.js';

/**
 * Putting a picture where somebody wants it on the key.
 *
 * A picture fills the key edge to edge, which is right for a photograph and
 * wrong for a glyph — and there is no setting for it, deliberately: one that
 * changed how a picture met the key's edge was offered on every icon, where
 * what people wanted was for the picture to fill the key.
 *
 * So this is not a setting. The picture is placed once, in an editor, and what
 * comes out is an ordinary SVG with the picture inside it at the size and in
 * the corner it was put. Nothing downstream knows a placement ever happened:
 * the panel, the compositor and the browser each see a picture, and draw it.
 *
 * The placement is recorded in the icon's own metadata so it can be taken apart
 * again — the alternative was baking it and losing it, which this program did
 * once before and undid.
 *
 * # Why the layers are prefixed, always
 *
 * Inlining one picture into another puts two of everything into one document,
 * and every one of them collides silently:
 *
 * - two `<metadata id="easydeck">`, of which the reader sees only the first;
 * - two `id="ring"`, of which `url(#ring)` resolves to the first — measured on
 *   librsvg, which draws the second shape with the first one's gradient;
 * - two `--angle`, substituted from one value, so both needles swing together;
 * - two `:root` blocks, of which the last one wins.
 *
 * The answer is to rename rather than to nest: each layer's names are given a
 * prefix of its own, its metadata is *consumed* and folded into the wrapper's
 * single block, and what comes out is one file with one of everything. Every
 * reader downstream then needs no idea any of this happened — which is the same
 * bargain the placement itself makes.
 *
 * Prefixing starts at the first layer even though one layer can collide with
 * nothing. A key's bindings are stored under the parameter names, so a picture
 * that grew a second layer later would have to rename the first one's
 * parameters, and every binding made against them would quietly point at
 * nothing.
 */

/** Where one picture sits inside a composed one, in the wrapper's own units. */
export interface IconLayer {
  /** Also the id of the element holding it, and the prefix for its names. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A picture to place, as the editor hands it over. */
export interface PlacedPicture {
  /** Markup or a data URL — whatever the library or the file gave. */
  readonly source: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The wrapper's own coordinates, chosen so a placement reads as a percentage.
 *
 * A key is square and a hundred is a round number, so `x: 20, width: 60` is
 * plainly "a fifth in from the left, three fifths wide" to anyone opening the
 * file — including whoever is reading it to work out what went wrong.
 */
export const ICON_CANVAS = 100;

/** The layers a composed picture holds, or none if it is an ordinary one. */
export function readIconLayers(svg: string): IconLayer[] {
  const text = easydeckMetadata(svg);
  if (text === undefined) return [];

  try {
    const parsed = JSON.parse(text) as { layers?: unknown };
    if (!Array.isArray(parsed.layers)) return [];

    return parsed.layers.filter(
      (layer): layer is IconLayer =>
        typeof layer === 'object' &&
        layer !== null &&
        typeof (layer as IconLayer).id === 'string' &&
        ['x', 'y', 'width', 'height'].every(
          (key) => typeof (layer as unknown as Record<string, unknown>)[key] === 'number',
        ),
    );
  } catch {
    return [];
  }
}

/** Whether this picture was put together here, and can be taken apart again. */
export function isComposedIcon(source: string): boolean {
  const svg = svgTextOf(source);
  return svg !== undefined && readIconLayers(svg).length > 0;
}

/**
 * Builds one picture out of several placed ones.
 *
 * Painter's order: later in the list is nearer the front, which is the order
 * they are written in and the order any renderer draws them.
 */
export function composeIcon(pictures: readonly PlacedPicture[]): string {
  const layers: IconLayer[] = [];
  const params: IconParam[] = [];
  const palette: IconColorSlot[] = [];
  const bodies: string[] = [];

  pictures.forEach((picture, index) => {
    const id = `l${index + 1}`;
    const prepared = prepareLayer(picture, id, index + 1);

    layers.push({ id, x: picture.x, y: picture.y, width: picture.width, height: picture.height });
    params.push(...prepared.params);
    palette.push(...prepared.palette);
    bodies.push(prepared.markup);
  });

  const metadata = JSON.stringify({
    layers,
    ...(params.length > 0 ? { params } : {}),
    ...(palette.length > 0 ? { palette } : {}),
  });

  /*
   * `slice` rather than the default, so a composed picture meets the key's
   * edge the way every other picture does: filling it, cropped if the region
   * is not square. Anything else would make going through the editor change
   * how a picture sits, which is not what the editor is for.
   */
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${ICON_CANVAS} ${ICON_CANVAS}" preserveAspectRatio="xMidYMid slice">` +
    `<metadata id="easydeck">${metadata}</metadata>` +
    bodies.join('') +
    `</svg>`
  );
}

/** The artwork of one layer, as it was before it was placed. */
export function readLayerSource(svg: string, id: string): string | undefined {
  const vector = elementWithId(svg, 'svg', id);
  if (vector) return unprefix(vector.inner, id, vector.open);

  const raster = elementWithId(svg, 'image', id);
  return raster ? attribute(raster.open, 'href') ?? attribute(raster.open, 'xlink:href') : undefined;
}

// --- putting one layer in ------------------------------------------------

interface PreparedLayer {
  readonly markup: string;
  readonly params: readonly IconParam[];
  readonly palette: readonly IconColorSlot[];
}

function prepareLayer(picture: PlacedPicture, id: string, ordinal: number): PreparedLayer {
  const place = `x="${picture.x}" y="${picture.y}" width="${picture.width}" height="${picture.height}"`;

  const svg = svgTextOf(picture.source);
  if (svg === undefined) {
    /*
     * A raster, which has nothing to rename and nothing to declare.
     *
     * `meet` because the editor showed the whole picture inside the box that
     * was dragged: a photograph that cropped itself differently once placed
     * would be a picture nobody chose.
     */
    return {
      markup: `<image id="${id}" ${place} preserveAspectRatio="xMidYMid meet" href="${escapeAttribute(picture.source)}"/>`,
      params: [],
      palette: [],
    };
  }

  /*
   * Vector art is inlined rather than referenced.
   *
   * An `<image>` pointing at an SVG is a document of its own: no `color`
   * reaches it, so `currentColor` stops answering the colour button, and no
   * `var()` of ours is ever substituted into it, so a parametric picture stops
   * answering its variable. Inlining is what keeps both alive, and it is why
   * everything below has to be renamed.
   */
  const params = readIconParams(svg).map((param) => renamed(param, id, ordinal));
  const palette = readIconPalette(svg).map((slot) => renamed(slot, id, ordinal));

  const inner = withoutMetadata(innerOf(svg));
  const viewBox = viewBoxOf(svg);

  // Baked here, against this layer's own coordinates. Left for later it would
  // be resolved against the wrapper's viewBox, which is a different picture's
  // idea of where the middle is.
  const prefixed = prefixNames(expandTransformOrigin(`<svg ${viewBox ? `viewBox="${viewBox}"` : ''}>${inner}</svg>`), id);

  return {
    markup:
      `<svg id="${id}" ${place}${viewBox ? ` viewBox="${viewBox}"` : ''} preserveAspectRatio="xMidYMid meet">` +
      innerOf(prefixed) +
      `</svg>`,
    params,
    palette,
  };
}

/**
 * The coordinate system the artwork was drawn in.
 *
 * A picture without a `viewBox` is measured by its own `width` and `height`,
 * and one measured by neither has nothing to say about its coordinates — its
 * numbers are then read in the box it was placed in, which is the only reading
 * left.
 */
function viewBoxOf(svg: string): string | undefined {
  const open = openTagOf(svg) ?? '';
  const declared = attribute(open, 'viewBox');
  if (declared) return declared;

  const width = Number.parseFloat(attribute(open, 'width') ?? '');
  const height = Number.parseFloat(attribute(open, 'height') ?? '');
  return Number.isFinite(width) && Number.isFinite(height) ? `0 0 ${width} ${height}` : undefined;
}

/**
 * Gives every name this layer owns a prefix nothing else can collide with.
 *
 * `:root` is left exactly as it is, and can be: once the properties under it
 * are named apart, two layers declaring their defaults on the same root are no
 * longer saying anything about each other. Rewriting the selector would have
 * meant relying on how a rasterizer resolves one, for no gain.
 */
function prefixNames(svg: string, prefix: string): string {
  return (
    svg
      // Custom properties, in their declarations and wherever they are read.
      // Every one of them, not only the declared ones: an undeclared property
      // is still read out of the text and still collides.
      .replace(/--([A-Za-z0-9_-]+)/g, `--${prefix}-$1`)
      .replace(/(\sid\s*=\s*")([^"]*)(")/gi, `$1${prefix}-$2$3`)
      .replace(/url\(\s*#([^)\s]+)\s*\)/gi, `url(#${prefix}-$1)`)
      .replace(/((?:xlink:)?href\s*=\s*")#([^"]*)(")/gi, `$1#${prefix}-$2$3`)
  );
}

/** Undoes `prefixNames`, for handing a layer back to the editor. */
function unprefix(inner: string, prefix: string, open: string): string {
  const body = inner
    .replace(new RegExp(`--${prefix}-`, 'g'), '--')
    .replace(new RegExp(`(\\sid\\s*=\\s*")${prefix}-`, 'gi'), '$1')
    .replace(new RegExp(`url\\(#${prefix}-`, 'gi'), 'url(#')
    .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*")#${prefix}-`, 'gi'), '$1#');

  const viewBox = attribute(open, 'viewBox');
  return `<svg xmlns="http://www.w3.org/2000/svg"${viewBox ? ` viewBox="${viewBox}"` : ''}>${body}</svg>`;
}

/**
 * A parameter as it appears once its picture is one layer among several.
 *
 * The name carries the prefix because that is what keeps it apart; the label
 * carries the layer's number because that is what tells a person which of two
 * identical needles they are about to bind.
 */
function renamed<T extends { name: string; label?: LocalizedText }>(
  declaration: T,
  prefix: string,
  ordinal: number,
): T {
  const label = declaration.label
    ? Object.fromEntries(
        Object.entries(declaration.label).map(([locale, text]) => [locale, `${ordinal}. ${text}`]),
      )
    : undefined;

  return {
    ...declaration,
    name: `${prefix}-${declaration.name}`,
    ...(label ? { label } : {}),
  };
}

// --- the small amount of markup handling this needs -----------------------

function openTagOf(svg: string): string | undefined {
  return /<svg\b[^>]*>/i.exec(svg)?.[0];
}

/** Everything between an element's own tags. */
function innerOf(svg: string): string {
  const open = openTagOf(svg);
  if (!open) return svg;

  const start = svg.indexOf(open) + open.length;
  const end = svg.lastIndexOf('</svg>');
  return end > start ? svg.slice(start, end) : svg.slice(start);
}

/**
 * Removes the layer's own declaration block.
 *
 * Consumed rather than carried along: two blocks with one id is invalid, the
 * reader would see only whichever came first, and what it declared has already
 * been lifted into the wrapper's own block under a name of its own.
 */
function withoutMetadata(svg: string): string {
  return svg.replace(/<metadata\b[^>]*\bid=["']easydeck["'][^>]*>[\s\S]*?<\/metadata>/i, '');
}

function attribute(tag: string, name: string): string | undefined {
  const found = new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return found?.[1];
}

/** An element of this name carrying this id, with its opening tag and body. */
function elementWithId(
  svg: string,
  tag: string,
  id: string,
): { open: string; inner: string } | undefined {
  const opening = new RegExp(`<${tag}\\b[^>]*\\sid\\s*=\\s*["']${id}["'][^>]*>`, 'i').exec(svg);
  if (!opening?.[0]) return undefined;

  const open = opening[0];
  const start = opening.index + open.length;

  // Self-closing, which is how a raster layer is written.
  if (open.endsWith('/>')) return { open, inner: '' };

  return { open, inner: balancedBody(svg, tag, start) };
}

/** The body of an element, counting nested ones of the same name. */
function balancedBody(svg: string, tag: string, start: number): string {
  const marks = new RegExp(`<${tag}\\b|</${tag}>`, 'gi');
  marks.lastIndex = start;

  let depth = 1;
  for (let mark = marks.exec(svg); mark; mark = marks.exec(svg)) {
    depth += mark[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return svg.slice(start, mark.index);
  }

  return svg.slice(start);
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, '&quot;');
}
