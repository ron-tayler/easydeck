import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FLOOR_DB, drawMeter, levelOf } from './obs-meter.js';

const style = {
  vertical: false,
  thickness: 0.2,
  calm: '#3fb950',
  loud: '#d29922',
  hot: '#f85149',
  warnAt: 0.75,
  hotAt: 0.92,
};

describe('a level from what OBS reports', () => {
  it('is logarithmic, because hearing is', () => {
    /*
     * Drawn straight from the multiplier, a normal speaking voice — about a
     * twentieth of full scale — would be a stub at the bottom of the key while
     * sounding perfectly loud, and the meter would look broken rather than
     * quiet.
     */
    assert.equal(levelOf(1), 1);

    // Measured on the developer's machine, and the numbers OBS's own mixer
    // showed for the same moment: desktop audio at 0.72, a quiet room at 0.07.
    assert.ok(levelOf(0.72) > 0.9, 'nearly the whole bar');
    assert.ok(levelOf(0.07) > 0.55 && levelOf(0.07) < 0.68, 'about six tenths');
  });

  it('bottoms out where OBS does', () => {
    // Below the mixer's own floor a meter is measuring the room rather than
    // the person in it.
    const floor = 10 ** (FLOOR_DB / 20);

    assert.equal(levelOf(floor), 0);
    assert.equal(levelOf(floor / 2), 0);
    assert.equal(levelOf(0), 0);
  });

  it('answers nothing for a number that is not one', () => {
    assert.equal(levelOf(Number.NaN), 0);
    assert.equal(levelOf(-1), 0);
  });
});

describe('drawing a meter', () => {
  it('is a strip, not the whole key', () => {
    // So the label underneath still says which input it is about.
    const svg = drawMeter(1, style);

    assert.match(svg, /height="20"/);
    assert.match(svg, /y="80"/);
  });

  it('colours by where the bar is, not by how loud it got', () => {
    /*
     * A bar reaching into the red is green, then amber, then red — which is
     * what every mixer in the world looks like and therefore needs no
     * explaining.
     */
    const full = drawMeter(1, style);
    assert.match(full, /#3fb950/);
    assert.match(full, /#d29922/);
    assert.match(full, /#f85149/);

    const quiet = drawMeter(0.5, style);
    assert.match(quiet, /#3fb950/);
    assert.doesNotMatch(quiet, /#d29922/);
    assert.doesNotMatch(quiet, /#f85149/);
  });

  it('draws nothing but the background for silence', () => {
    const svg = drawMeter(0, { ...style, background: '#101820' });

    assert.match(svg, /#101820/);
    assert.doesNotMatch(svg, /#3fb950/);
  });

  it('grows upward when it is put on the side', () => {
    // The one direction a level is ever drawn in.
    const svg = drawMeter(0.5, { ...style, vertical: true });

    assert.match(svg, /y="50"/);
    assert.match(svg, /height="50"/);
  });

  it('grows the viewBox with the keys it covers', () => {
    assert.match(drawMeter(1, style, 3, 1), /viewBox="0 0 300 100"/);
    assert.match(drawMeter(1, style, 2, 2), /viewBox="0 0 200 200"/);
  });

  it('will not let a colour out of its attribute', () => {
    // The colour fields are free text and this ends up inside an attribute.
    const svg = drawMeter(1, { ...style, calm: '"><script>alert(1)</script>' });

    assert.doesNotMatch(svg, /<script>/);
    assert.match(svg, /fill="&#34;/);
  });
});
