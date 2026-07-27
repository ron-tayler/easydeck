/**
 * Checks that a rendered key image lands on the display exactly.
 *
 * Run with:  pnpm --filter @easydeck/renderer alignment
 *
 * Every key gets the same strictly symmetric pattern: a frame hugging the
 * outermost pixels, a second frame inset by 10, a centre crosshair and a tick
 * at the middle of each edge. On a correctly sized and positioned image all
 * fifteen keys look identical and symmetric, and every tick sits exactly
 * halfway along its edge.
 *
 * What the failure modes look like:
 *   - a missing frame side          -> the image overruns the display there
 *   - an uneven gap around the frame -> the image is smaller than the display
 *   - ticks drifting off centre going down the key -> row shear, i.e. the
 *     image width does not match the display stride
 */
import { createDeviceManager } from '@easydeck/device';

import { createKeyRenderer } from '../index.js';
import type { RenderTarget } from '../index.js';
import { alignmentPattern } from './patterns.js';

async function main(): Promise<void> {
  const surface = await createDeviceManager().openFirst({ brightness: 70 });
  const renderer = await createKeyRenderer();

  const size = surface.keyImage.width;
  const target: RenderTarget = {
    width: size,
    height: surface.keyImage.height,
    rotationDegrees: surface.keyImage.rotationDegrees,
    maxBytes: surface.keyImage.maxBytes,
  };
  console.log(`Opened ${surface.info.modelName}, testing ${size}x${surface.keyImage.height}`);

  const pattern = alignmentPattern(size);
  for (let key = 0; key < surface.layout.rows * surface.layout.cols; key++) {
    const jpeg = await renderer.render(
      { background: '#000000', cornerRadius: 0, icon: { source: pattern, fit: 'cover' } },
      target,
    );
    await surface.setKeyImage(key, Buffer.from(jpeg));
  }

  console.log('All keys painted with the alignment pattern.');
  console.log('White ring should touch every display edge; yellow ticks should be centred.');
  console.log('Ctrl+C to exit.');

  process.on('SIGINT', () => {
    void surface
      .clearAllKeys()
      .then(() => surface.close())
      .finally(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
