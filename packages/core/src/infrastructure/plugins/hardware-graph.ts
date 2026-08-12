/**
 * A reading over time, drawn as a key.
 *
 * The first live surface, and written to be the example: everything here is a
 * pure function of numbers and colours, so what the panel shows can be checked
 * without a panel. The plugin above keeps the history and hands it over.
 *
 * SVG rather than pixels, because the engine asks for a picture in *keys* and
 * not in pixels — the panel's resolution is on the other side of a boundary it
 * deliberately does not cross — and an SVG is the one answer that does not
 * need to know.
 */

/** How the user wants it to look. Everything here comes from the key's form. */
export interface GraphStyle {
  readonly line: string;
  readonly fill?: string;
  readonly background?: string;
  /** Drawn behind the line, at the value the reading is measured against. */
  readonly max: number;
  readonly thickness: number;
}

/**
 * A ring of readings, oldest first.
 *
 * Kept as plain numbers with a fixed length rather than as timestamped
 * samples: the beat that fills it is regular, so position *is* time, and a
 * graph that has not been filled yet simply starts partway along.
 */
export class History {
  private readonly values: number[] = [];

  constructor(private readonly capacity: number) {}

  push(value: number): void {
    this.values.push(value);
    while (this.values.length > this.capacity) this.values.shift();
  }

  /** The last `count` readings, oldest first; fewer if that is all there is. */
  recent(count: number): number[] {
    return this.values.slice(Math.max(0, this.values.length - count));
  }

  get length(): number {
    return this.values.length;
  }
}

/**
 * The picture, as SVG text.
 *
 * Two readings are the fewest that can be a line, so anything less draws the
 * background alone rather than a dot in the corner — a key that says "not yet"
 * by being empty, which is what an empty graph looks like anyway.
 *
 * The viewBox follows the key rectangle, so a graph stretched over three keys
 * is three times as wide and not three times as coarse.
 */
export function drawGraph(
  readings: readonly number[],
  style: GraphStyle,
  cols = 1,
  rows = 1,
): string {
  const { background, max, ...rest } = style;
  return drawGraphs([{ readings, ...rest }], { max, ...(background ? { background } : {}) }, cols, rows);
}

/** One series of a graph: its numbers and how it is drawn. */
export interface Series {
  readonly readings: readonly number[];
  readonly line: string;
  readonly fill?: string;
  readonly thickness: number;
}

/** What the whole picture shares, whatever is drawn on it. */
export interface GraphFrame {
  /** Drawn behind the lines, at the value the readings are measured against. */
  readonly max: number;
  readonly background?: string;
}

/**
 * Several series on one picture, sharing a ceiling and an axis.
 *
 * Sharing the ceiling is the whole point of drawing them together: what a
 * download and an upload on one key are *for* is comparing them, and two
 * graphs each scaled to their own peak would show a trickle and a torrent as
 * the same shape.
 *
 * Drawn in the order given, so whatever is listed last sits on top. The caller
 * decides; here that is the upload, because it is usually the smaller of the
 * two and would otherwise be buried under the download's shading.
 */
export function drawGraphs(
  series: readonly Series[],
  frame: GraphFrame,
  cols = 1,
  rows = 1,
): string {
  const width = 100 * cols;
  const height = 100 * rows;
  const ceiling = frame.max > 0 ? frame.max : 100;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  ];

  if (frame.background) {
    parts.push(`<rect width="${width}" height="${height}" fill="${escape(frame.background)}"/>`);
  }

  for (const one of series) {
    if (one.readings.length < 2) continue;

    const step = width / (one.readings.length - 1);
    const at = (value: number, index: number): string => {
      const y = height - (clamp(value, 0, ceiling) / ceiling) * height;
      return `${round(index * step)},${round(y)}`;
    };

    const line = one.readings.map(at).join(' ');

    // The fill is the same line closed along the bottom. Drawn first so the
    // line itself sits on top of its own shading rather than under it.
    if (one.fill) {
      parts.push(
        `<polygon points="0,${height} ${line} ${width},${height}" fill="${escape(one.fill)}"/>`,
      );
    }

    parts.push(
      `<polyline points="${line}" fill="none" stroke="${escape(one.line)}"` +
        ` stroke-width="${one.thickness}" stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

/**
 * A ceiling that fits what is being drawn, for a reading with no natural one.
 *
 * Rounded up to something a person would say — 1, 2, 5, 10, 20, 50 — so the
 * scale stops jittering with every sample and a graph redrawn a second later
 * is the same graph. A quarter of headroom above the peak keeps the busiest
 * moment off the top edge.
 *
 * Never zero: an adapter carrying nothing would otherwise divide by it.
 */
export function busiest(readings: readonly number[]): number {
  const peak = readings.reduce((most, value) => Math.max(most, value), 0);
  if (peak <= 0) return 1;

  const wanted = peak * 1.25;
  const decade = 10 ** Math.floor(Math.log10(wanted));

  for (const step of [1, 2, 5, 10]) {
    if (wanted <= step * decade) return step * decade;
  }

  return 10 * decade;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Two decimals is finer than any panel can show and keeps the text short. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Colours come from a form somebody filled in, and land inside an attribute.
 *
 * Nothing here trusts the value to be a colour: the field is free text, and a
 * quote in it would otherwise close the attribute and let the rest be markup.
 */
function escape(value: string): string {
  return value.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
