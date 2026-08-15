import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  backgroundCss,
  backgroundSignature,
  colorAt,
  gradientLine,
  hasGradient,
  withBase,
  withoutGradient,
} from './background.js';
import type { GradientBackground } from './background.js';

/**
 * The shapes both surfaces draw from.
 *
 * What is worth asserting here is not that a particular string comes out — the
 * browser would accept several — but the three things a wrong answer would cost
 * somebody: a preview that disagrees with the key, a spot that fades through
 * grey, and a cache that hands back the wrong tile.
 */

const gradient: GradientBackground = {
  base: '#101010',
  linear: {
    angle: 90,
    stops: [
      { color: '#ff0000', at: 0 },
      { color: '#0000ff', at: 1 },
    ],
  },
  spots: [{ color: '#ffcc00', x: 0.25, y: 0.75, radius: 0.4 }],
};

describe('a background', () => {
  it('is still a plain colour when nothing was done to it', () => {
    assert.equal(backgroundCss('#123456'), '#123456');
    assert.equal(hasGradient('#123456'), false);
    assert.equal(backgroundSignature('#123456'), '#123456');
  });

  it('falls back only when there is nothing at all', () => {
    assert.equal(backgroundCss(undefined, '#000000'), '#000000');
    assert.equal(backgroundCss({ base: '#222222' }), '#222222');
  });

  it('gives up its gradient and goes back to being a colour', () => {
    assert.equal(withoutGradient(gradient), '#101010');
    assert.deepEqual(withBase(gradient, '#ffffff'), { ...gradient, base: '#ffffff' });
    assert.equal(withBase('#101010', '#ffffff'), '#ffffff');
  });

  it('draws its layers over the colour, spots on top', () => {
    const css = backgroundCss(gradient);

    assert.ok(css.startsWith('radial-gradient('), 'the spot is the topmost layer');
    assert.ok(css.includes('linear-gradient(90deg'), 'the ramp is under it');
    assert.ok(css.endsWith(', #101010'), 'the flat colour is underneath everything');
  });

  it('fades a spot to its own colour rather than to transparent', () => {
    // Fading to `transparent` — transparent black — is what puts a grey ring
    // around a coloured spot. Every stop keeps the same three channels.
    const css = backgroundCss({ base: '#000000', spots: gradient.spots ?? [] });

    assert.ok(css.includes('rgba(255, 204, 0, 1)'), 'full strength at the centre');
    assert.ok(css.includes('rgba(255, 204, 0, 0)'), 'and gone at the edge, still yellow');
  });

  it('reads the alpha a colour carries', () => {
    assert.equal(colorAt('#ff000080', 1), 'rgba(255, 0, 0, 0.502)');
    assert.equal(colorAt('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
    // Half of a half: an already faded colour cannot be made stronger by the
    // falloff, or a spot's centre would be more opaque than the colour chosen.
    assert.equal(colorAt('#ff000080', 0.5), 'rgba(255, 0, 0, 0.251)');
  });

  it('sorts stops so neither surface is handed a list that runs backwards', () => {
    const css = backgroundCss({
      base: '#000000',
      linear: {
        angle: 0,
        stops: [
          { color: '#ffffff', at: 1 },
          { color: '#000000', at: 0 },
        ],
      },
    });

    assert.ok(css.indexOf('rgba(0, 0, 0, 1) 0%') < css.indexOf('rgba(255, 255, 255, 1) 100%'));
  });
});

describe('a gradient line', () => {
  it('runs bottom to top at nought degrees, as CSS counts them', () => {
    const line = gradientLine(0, 100, 100);

    assert.deepEqual(
      { x0: line.x0, y0: line.y0, x1: line.x1, y1: line.y1 },
      { x0: 50, y0: 100, x1: 50, y1: 0 },
    );
  });

  it('runs left to right at ninety', () => {
    const line = gradientLine(90, 100, 60);

    assert.ok(Math.abs(line.x0 - 0) < 0.001 && Math.abs(line.x1 - 100) < 0.001);
    assert.ok(Math.abs(line.y0 - 30) < 0.001 && Math.abs(line.y1 - 30) < 0.001);
  });

  it('is long enough to reach the corners on the diagonal', () => {
    const line = gradientLine(45, 100, 100);
    const length = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);

    // CSS's own definition: the ends sit where the corners project onto the
    // line, which for a square at 45° is the full diagonal.
    assert.ok(Math.abs(length - Math.SQRT2 * 100) < 0.001, `line was ${length}`);
  });
});

describe('a background signature', () => {
  it('is the same for two gradients built in a different order', () => {
    const other: GradientBackground = {
      spots: [{ radius: 0.4, y: 0.75, x: 0.25, color: '#ffcc00' }],
      linear: {
        stops: [
          { at: 0, color: '#ff0000' },
          { at: 1, color: '#0000ff' },
        ],
        angle: 90,
      },
      base: '#101010',
    };

    assert.equal(backgroundSignature(other), backgroundSignature(gradient));
  });

  it('changes when anything about the picture does', () => {
    const base = backgroundSignature(gradient);

    assert.notEqual(base, backgroundSignature({ ...gradient, base: '#101011' }));
    assert.notEqual(
      base,
      backgroundSignature({ ...gradient, linear: { ...gradient.linear!, angle: 91 } }),
    );
    assert.notEqual(
      base,
      backgroundSignature({
        ...gradient,
        spots: [{ ...gradient.spots![0]!, radius: 0.41 }],
      }),
    );
    assert.notEqual(base, backgroundSignature({ ...gradient, spots: [] }));
  });

  it('tells a colour apart from a gradient standing on it', () => {
    assert.notEqual(backgroundSignature('#101010'), backgroundSignature(gradient));
  });
});
