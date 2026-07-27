import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

/**
 * Draws a strictly symmetric calibration target of `size` pixels with its
 * top-left corner at (0, 0) of the given context.
 *
 * Reading it: a missing ring side means the frame overruns the display there;
 * an uneven gap means the frame is too small; ticks drifting sideways from
 * top to bottom mean the rows are shearing.
 */
function drawTarget(ctx: SKRSContext2D, size: number): void {
  const mid = size / 2;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  // Outermost ring, drawn as four rects so it is exactly at the edge.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, 2);
  ctx.fillRect(0, size - 2, size, 2);
  ctx.fillRect(0, 0, 2, size);
  ctx.fillRect(size - 2, 0, 2, size);

  // Inset ring, for judging the gap to the display edge.
  ctx.strokeStyle = '#00c8ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(11, 11, size - 22, size - 22);

  // Centre crosshair.
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mid, mid - 16);
  ctx.lineTo(mid, mid + 16);
  ctx.moveTo(mid - 16, mid);
  ctx.lineTo(mid + 16, mid);
  ctx.stroke();

  // Edge ticks: these must stay in line with the crosshair.
  ctx.fillStyle = '#ffd60a';
  ctx.fillRect(mid - 1, 2, 3, 12);
  ctx.fillRect(mid - 1, size - 14, 3, 12);
  ctx.fillRect(2, mid - 1, 12, 3);
  ctx.fillRect(size - 14, mid - 1, 12, 3);
}

/** The calibration target on its own, as a PNG. */
export function alignmentPattern(size: number): Buffer {
  const canvas = createCanvas(size, size);
  drawTarget(canvas.getContext('2d'), size);
  return canvas.toBuffer('image/png');
}
