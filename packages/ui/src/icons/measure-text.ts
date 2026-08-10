/**
 * Measuring text the way the panel measures it.
 *
 * The daemon lays a label out against Skia's metrics for DejaVu Sans; the
 * window has the same font file loaded as `EasyDeck Sans`, and a canvas gives
 * the same answers from it. Asking the browser's own layout instead — a hidden
 * element, `getBoundingClientRect` — would measure a different thing at a
 * different moment, and the two surfaces would drift apart again.
 *
 * One canvas for the whole window: creating one per key per repaint is the
 * kind of thing that turns a smooth grid into a stuttering one.
 */

import type { TextExtent } from '@easydeck/engine/label';

const FAMILY = "'EasyDeck Sans', system-ui, sans-serif";

let context: CanvasRenderingContext2D | undefined;

function measuringContext(): CanvasRenderingContext2D | undefined {
  if (context) return context;

  const canvas = document.createElement('canvas');
  context = canvas.getContext('2d') ?? undefined;
  return context;
}

export function measureKeyText(text: string, fontSize: number): TextExtent {
  const ctx = measuringContext();
  // No canvas at all — an ancient browser, a locked-down page — is answered
  // with an estimate rather than a crash: half an em per character is close
  // enough for a sans-serif that the label still lands on the key.
  if (!ctx) {
    return {
      width: text.length * fontSize * 0.5,
      ascent: fontSize * 0.72,
      descent: fontSize * 0.2,
      fontAscent: fontSize * 1.1,
    };
  }

  ctx.font = `${fontSize}px ${FAMILY}`;
  const measured = ctx.measureText(text);

  return {
    width: measured.width,
    ascent: measured.actualBoundingBoxAscent,
    descent: measured.actualBoundingBoxDescent,
    fontAscent: measured.fontBoundingBoxAscent,
  };
}
