/**
 * A level meter, drawn as a key.
 *
 * Pure, like the hardware graph next door and for the same reason: everything
 * that can be wrong here is arithmetic about numbers and colours, and none of
 * it needs a panel to check.
 */

export interface MeterStyle {
  /** Along the bottom, or up one side. */
  readonly vertical: boolean;
  /** How much of the key the bar takes across its short side, 0..1. */
  readonly thickness: number;
  readonly calm: string;
  readonly loud: string;
  readonly hot: string;
  readonly background?: string;
  /** Where amber starts and where red starts, as shares of the scale. */
  readonly warnAt: number;
  readonly hotAt: number;
}

/**
 * The quietest sound worth drawing, in decibels.
 *
 * The same floor OBS puts on its own mixer. Below this a meter is measuring
 * the room rather than the person in it.
 */
export const FLOOR_DB = -60;

/**
 * A level as a share of the scale, from the multiplier OBS reports.
 *
 * Logarithmic, because hearing is. Drawn straight from the multiplier, a
 * normal speaking voice — around a twentieth of full scale — would be a stub
 * at the very bottom of the key while sounding perfectly loud, and the meter
 * would look broken rather than quiet.
 *
 * Measured on the developer's machine: desktop audio at 0.72 of full scale is
 * −2.8 dB and nearly the whole bar; a quiet room on the microphone reads 0.07,
 * which is −23 dB and about six tenths. Those are the numbers OBS's own mixer
 * shows for the same moment.
 */
export function levelOf(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 0;

  const db = 20 * Math.log10(Math.min(1, multiplier));
  if (db <= FLOOR_DB) return 0;

  return Math.min(1, (db - FLOOR_DB) / -FLOOR_DB);
}

/**
 * The picture, as SVG text.
 *
 * A strip rather than the whole key, so the meter is one layer of the face and
 * the label and the icon underneath still say *which* microphone it is. The
 * key's own background shows through unless one is asked for.
 *
 * Coloured by where each part of the bar sits rather than by how loud it is
 * overall: a bar reaching into the red is green, then amber, then red, which is
 * what every mixer in the world looks like and therefore needs no explaining.
 */
export function drawMeter(level: number, style: MeterStyle, cols = 1, rows = 1): string {
  const width = 100 * cols;
  const height = 100 * rows;
  const filled = Math.max(0, Math.min(1, level));

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  ];

  if (style.background) {
    parts.push(`<rect width="${width}" height="${height}" fill="${escape(style.background)}"/>`);
  }

  const thick = Math.max(2, Math.min(1, style.thickness) * (style.vertical ? width : height));

  // Zones as shares of the scale, clipped to how much of the bar is lit.
  const zones: [number, number, string][] = [
    [0, Math.min(filled, style.warnAt), style.calm],
    [style.warnAt, Math.min(filled, style.hotAt), style.loud],
    [style.hotAt, filled, style.hot],
  ];

  for (const [from, to, colour] of zones) {
    if (to <= from) continue;

    // Vertical grows upward from the bottom, which is the one direction a
    // level is ever drawn in; horizontal grows rightward from the left.
    const box = style.vertical
      ? { x: 0, y: height - to * height, w: thick, h: (to - from) * height }
      : { x: from * width, y: height - thick, w: (to - from) * width, h: thick };

    parts.push(
      `<rect x="${round(box.x)}" y="${round(box.y)}" width="${round(box.w)}" ` +
        `height="${round(box.h)}" fill="${escape(colour)}"/>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}

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
