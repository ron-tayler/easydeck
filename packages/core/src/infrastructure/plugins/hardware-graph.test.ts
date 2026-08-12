import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { History, drawGraph } from './hardware-graph.js';

describe('a history of readings', () => {
  it('keeps the newest and drops the oldest', () => {
    const kept = new History(3);
    for (const value of [1, 2, 3, 4, 5]) kept.push(value);

    assert.deepEqual(kept.recent(3), [3, 4, 5]);
    assert.equal(kept.length, 3);
  });

  it('answers with what it has when asked for more', () => {
    // The first minute after the daemon starts: a five-minute graph shows the
    // thirty seconds that exist rather than nothing.
    const kept = new History(100);
    kept.push(10);
    kept.push(20);

    assert.deepEqual(kept.recent(50), [10, 20]);
  });
});

describe('drawing it', () => {
  const style = { line: '#6ea8fe', max: 100, thickness: 4 };

  it('puts the newest reading at the right-hand edge', () => {
    // Time runs left to right, which is the only arrangement anybody reads
    // without being told.
    const svg = drawGraph([0, 100], style);
    assert.match(svg, /points="0,100 100,0"/);
  });

  it('measures against the ceiling it was given', () => {
    const svg = drawGraph([50, 50], style);
    // Half of a hundred is half the height, and the height is a hundred.
    assert.match(svg, /points="0,50 100,50"/);
  });

  it('grows the viewBox with the keys it covers', () => {
    // A graph stretched over three keys is wider, not coarser.
    assert.match(drawGraph([0, 0], style, 3, 1), /viewBox="0 0 300 100"/);
    assert.match(drawGraph([0, 0], style, 2, 2), /viewBox="0 0 200 200"/);
  });

  it('draws nothing but the background from a single reading', () => {
    // Two points are the fewest that can be a line; one would be a dot in the
    // corner, which reads as a fault rather than as "not yet".
    const svg = drawGraph([42], { ...style, background: '#101010' });

    assert.doesNotMatch(svg, /polyline/);
    assert.match(svg, /<rect[^>]*fill="#101010"/);
  });

  it('leaves the key’s own background showing when none was chosen', () => {
    const svg = drawGraph([1, 2], style);
    assert.doesNotMatch(svg, /<rect/);
  });

  it('closes the fill along the bottom, under the line', () => {
    const svg = drawGraph([0, 100], { ...style, fill: '#6ea8fe40' });

    assert.match(svg, /<polygon points="0,100 0,100 100,0 100,100"/);
    // The line is drawn after, so it sits on its own shading rather than under.
    assert.ok(svg.indexOf('polygon') < svg.indexOf('polyline'));
  });

  it('holds a reading above the ceiling to the top of the key', () => {
    const svg = drawGraph([200, 200], style);
    assert.match(svg, /points="0,0 100,0"/);
  });

  it('will not let a colour out of its attribute', () => {
    /*
     * The colour fields are free text, and this ends up inside an SVG
     * attribute. A quote in it would close the attribute and let whatever
     * follows be markup.
     */
    const svg = drawGraph([0, 1], { ...style, line: '"><script>alert(1)</script>' });

    assert.doesNotMatch(svg, /<script>/);
    assert.match(svg, /stroke="&#34;/);
  });
});
