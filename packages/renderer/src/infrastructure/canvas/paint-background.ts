import type { SKRSContext2D } from '@napi-rs/canvas';

import {
  SPOT_FALLOFF,
  colorAt,
  gradientLine,
  orderedStops,
} from '@easydeck/engine/background';
import type { BackgroundSpec, GradientSpot, LinearGradient } from '@easydeck/engine/background';

/**
 * The colour behind a region, and whatever is happening on it.
 *
 * Painted over the whole region rather than over each key: a gradient that
 * restarted at every seam would be six small gradients, and a picture stretched
 * across six keys already established that the region is the unit. A single key
 * is a region of one, so nothing here has a special case for it.
 *
 * The shapes come from the engine — the same functions the web preview uses to
 * write its CSS. What is left here is the part only a canvas can do.
 */
export function paintBackground(
  ctx: SKRSContext2D,
  spec: BackgroundSpec,
  width: number,
  height: number,
): void {
  if (typeof spec === 'string') {
    ctx.fillStyle = spec;
    ctx.fillRect(0, 0, width, height);
    return;
  }

  ctx.fillStyle = spec.base;
  ctx.fillRect(0, 0, width, height);

  if (spec.linear) paintLinear(ctx, spec.linear, width, height);
  for (const spot of spec.spots ?? []) paintSpot(ctx, spot, width, height);
}

function paintLinear(
  ctx: SKRSContext2D,
  linear: LinearGradient,
  width: number,
  height: number,
): void {
  const stops = orderedStops(linear.stops);
  if (stops.length === 0) return;

  const line = gradientLine(linear.angle, width, height);
  const paint = ctx.createLinearGradient(line.x0, line.y0, line.x1, line.y1);

  for (const stop of stops) {
    paint.addColorStop(Math.min(1, Math.max(0, stop.at)), colorAt(stop.color, 1));
  }

  ctx.fillStyle = paint;
  ctx.fillRect(0, 0, width, height);
}

/**
 * One spot of light, as an ellipse the size of the region rather than a circle.
 *
 * A canvas only draws circular gradients, so the circle is drawn into a
 * squashed coordinate system — which is exactly what the browser does with the
 * same numbers. On a key, which is square, the two are the same thing; across
 * a row of keys the spot stretches with the region, and stretching the same way
 * in both places is the whole point.
 */
function paintSpot(ctx: SKRSContext2D, spot: GradientSpot, width: number, height: number): void {
  const rx = spot.radius * width;
  const ry = spot.radius * height;
  if (!(rx > 0) || !(ry > 0)) return;

  const cx = spot.x * width;
  const cy = spot.y * height;
  const squash = rx / ry;

  const paint = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
  for (const [at, opacity] of SPOT_FALLOFF) paint.addColorStop(at, colorAt(spot.color, opacity));

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(squash, 1);

  // The whole region, in the squashed coordinates the spot is drawn in. The
  // gradient ends in a fully transparent stop, so covering more than the spot
  // reaches costs nothing and saves working out where it stops mattering.
  ctx.fillStyle = paint;
  ctx.fillRect(-cx / squash, -cy, width / squash, height);
  ctx.restore();
}
