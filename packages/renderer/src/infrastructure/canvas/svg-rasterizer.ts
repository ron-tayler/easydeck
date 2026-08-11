/**
 * Turning an SVG into pixels, with something that understands CSS.
 *
 * The canvas library draws SVG, but only its presentation attributes: a
 * `<style>` block is ignored outright, so a class that sets a fill draws
 * black and a transform in a rule does not move anything. That is fine for a
 * static icon and useless for one whose parameters are expressed the way
 * anybody who knows HTML would express them.
 *
 * librsvg — reached through sharp — understands classes and transforms in
 * CSS, and does it in about a millisecond and a half. Measured against the
 * alternatives before choosing: resvg understands classes but not transforms
 * and is a hundred times slower; the canvas library understands neither.
 *
 * Loaded lazily and allowed to be missing. It is a native module, and a
 * machine where it fails to build should lose the CSS in its icons rather
 * than the ability to draw a key.
 */

type Sharp = (input: Buffer) => {
  resize(width: number, height: number, options?: { fit?: string }): {
    png(): { toBuffer(): Promise<Buffer> };
  };
};

let sharp: Sharp | null | undefined;

async function load(): Promise<Sharp | null> {
  if (sharp !== undefined) return sharp;

  try {
    const module = (await import('sharp')) as unknown as { default: Sharp };
    sharp = module.default;
  } catch {
    sharp = null;
  }

  return sharp;
}

/** Whether a source is markup this module can do anything with. */
export function isSvgSource(source: string): boolean {
  return source.startsWith('<') || source.startsWith('data:image/svg+xml');
}

/**
 * Rasterizes an SVG to PNG bytes, or reports that it cannot.
 *
 * The size asked for is the size it will be drawn at, so the vector is
 * rendered at its final resolution rather than scaled afterwards — which is
 * the whole point of it being a vector.
 */
export async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
): Promise<Buffer | undefined> {
  const render = await load();
  if (!render) return undefined;

  try {
    return await render(Buffer.from(svg, 'utf8'))
      /*
       * `cover`, which is what every other picture on a key gets.
       *
       * It used to be `fill`, on the reasoning that a key is square and so is
       * an icon drawn for one. A button spanning three keys is not square —
       * that region is 364x112 — and a round dial stretched into it came out
       * an oval the window never showed, since the window covers. Only this
       * path was wrong, so a PNG beside it looked right and the disagreement
       * read as the gap between the displays being ignored.
       */
      .resize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), { fit: 'cover' })
      .png()
      .toBuffer();
  } catch {
    // A malformed icon, or a build of librsvg without something it uses.
    // The caller falls back to the canvas library, which will draw what it
    // can of it.
    return undefined;
  }
}
