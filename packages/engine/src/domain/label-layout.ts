import type { LabelSpec } from './visual.js';

/**
 * Where a key's text goes, decided once for every surface that draws it.
 *
 * The panel and the window used to work this out separately, and disagreed
 * about all of it: the window centred a label the panel put at the bottom, the
 * window wrapped onto a second line where the panel shrank the type until one
 * line fitted, and the two arrived at different sizes for the same authored
 * number. A preview that disagrees with the panel is worse than no preview, so
 * the rules live here and both sides follow them.
 *
 * The rules are deliberately few. The size is the one the user set — it is not
 * adjusted to make text fit, because a size that changes itself is a size
 * nobody can design against. Lines break at spaces and nowhere else; text that
 * still does not fit is drawn over the edge, which is visible and fixable by
 * putting a space where you want the break.
 *
 * Placement is measured against the **ink**, not the font's em box. A font
 * reserves room for accents above and descenders below, and that room is empty
 * for most key labels: positioning by it left "Свет" sitting well clear of the
 * edge it was supposed to touch, and looking off-centre when centred. What is
 * lined up here is the part you can actually see.
 *
 * Measuring is left to the caller, because only the caller has a font engine —
 * Skia in the daemon, the browser's own in the window. Both are handed the
 * same font file, so the same text measures the same on either side.
 */

export interface LabelBox {
  readonly width: number;
  readonly height: number;
}

/** What a canvas can say about a run of text, and what this needs of it. */
export interface TextExtent {
  readonly width: number;
  /** Ink above the baseline: `actualBoundingBoxAscent`. */
  readonly ascent: number;
  /** Ink below it: `actualBoundingBoxDescent`. */
  readonly descent: number;
  /** The font's own ascent, which is where a line box puts its baseline. */
  readonly fontAscent: number;
}

export type MeasureText = (text: string, fontSize: number) => TextExtent;

export interface LaidOutLabel {
  readonly lines: readonly string[];
  /** In the box's units, scaled from the authored size and nothing else. */
  readonly fontSize: number;
  /** Distance between one baseline and the next. */
  readonly lineHeight: number;
  /** Where each line's baseline sits, from the top of the key. */
  readonly baselines: readonly number[];
  /**
   * The font's ascent at this size.
   *
   * A canvas draws from the baseline directly; a browser positions a line box
   * and puts the baseline this far down inside it, so it needs the number to
   * land in the same place.
   */
  readonly fontAscent: number;
}

/**
 * Sizes are authored against a 100×100 key, which is what makes a profile
 * portable: the same number means the same fraction of the key on a panel
 * whose keys are 112px and in a window drawing them at 90.
 */
export const LABEL_REFERENCE_KEY = 100;
export const DEFAULT_FONT_SIZE = 22;
/** Kept clear on every side, so ink does not begin at the very edge. */
const MARGIN = 0.06;
const LINE_HEIGHT = 1.15;

/**
 * Where a label sits when the profile does not say.
 *
 * Over a picture it goes to the bottom, where it covers the least; on a plain
 * key it goes to the middle, because there is nothing to keep clear of.
 */
export function defaultLabelPosition(hasPicture: boolean): 'top' | 'center' | 'bottom' {
  return hasPicture ? 'bottom' : 'center';
}

export function layoutLabel(
  label: LabelSpec,
  box: LabelBox,
  measure: MeasureText,
  options: { readonly hasPicture?: boolean } = {},
): LaidOutLabel {
  const unit = Math.min(box.width, box.height) / LABEL_REFERENCE_KEY;
  const fontSize = (label.fontSize ?? DEFAULT_FONT_SIZE) * unit;

  const lines = wrap(label.text, box.width - box.width * MARGIN * 2, fontSize, measure);
  const lineHeight = fontSize * LINE_HEIGHT;

  const first = measure(lines[0] ?? '', fontSize);
  const last = measure(lines[lines.length - 1] ?? '', fontSize);

  // The block is as tall as the ink in it: the first line's rise, the gaps
  // between baselines, and whatever hangs below the last one.
  const ink = first.ascent + (lines.length - 1) * lineHeight + last.descent;

  const position = label.position ?? defaultLabelPosition(options.hasPicture === true);
  const margin = box.height * MARGIN;

  const top =
    position === 'top'
      ? margin
      : position === 'bottom'
        ? box.height - margin - ink
        : (box.height - ink) / 2;

  const baselines = lines.map((_, index) => top + first.ascent + index * lineHeight);

  return { lines, fontSize, lineHeight, baselines, fontAscent: first.fontAscent };
}

/**
 * Breaks text at spaces, and only there.
 *
 * A word wider than the key is left whole and hangs over the edge. Cutting it
 * mid-word produced "Инструмент / ы", which is worse than the overflow and
 * harder to notice; overflow is obvious, and the fix — a space, a shorter
 * word, a smaller size — belongs to whoever wrote the label.
 */
function wrap(
  text: string,
  width: number,
  fontSize: number,
  measure: MeasureText,
): readonly string[] {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let line = '';

    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (line !== '' && measure(candidate, fontSize).width > width) {
        lines.push(line);
        line = word;
        continue;
      }

      line = candidate;
    }

    lines.push(line);
  }

  return lines.length > 0 ? lines : [''];
}
