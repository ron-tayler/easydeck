import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { History, busiest, drawGraph, drawGraphs } from './hardware-graph.js';

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

describe('two series on one picture', () => {
  const down = { readings: [0, 50], line: '#6ea8fe', thickness: 3 };
  const up = { readings: [0, 25], line: '#f0a35e', thickness: 3 };

  it('measures both against one ceiling', () => {
    /*
     * The whole reason for drawing them together. Scaled to their own peaks,
     * a trickle and a torrent would be the same shape, and comparing them is
     * what putting them on one key is for.
     */
    const svg = drawGraphs([down, up], { max: 100 });

    assert.match(svg, /points="0,100 100,50" fill="none" stroke="#6ea8fe"/);
    assert.match(svg, /points="0,100 100,75" fill="none" stroke="#f0a35e"/);
  });

  it('draws them in the order given, so the last one is on top', () => {
    const svg = drawGraphs([down, up], { max: 100 });
    assert.ok(svg.indexOf('#6ea8fe') < svg.indexOf('#f0a35e'));
  });

  it('leaves out a series with nothing in it', () => {
    // What "in only" asks for: one line, not one line and an empty element.
    const svg = drawGraphs([down, { ...up, readings: [] }], { max: 100 });

    assert.match(svg, /#6ea8fe/);
    assert.doesNotMatch(svg, /#f0a35e/);
  });

  it('is still one graph when only one series was given', () => {
    // `drawGraph` is this with a list of one, so the older widget cannot drift
    // away from the newer one.
    assert.equal(
      drawGraph([0, 50], { line: '#6ea8fe', max: 100, thickness: 3 }),
      drawGraphs([down], { max: 100 }),
    );
  });
});

describe('a ceiling for a reading that has none', () => {
  it('rounds up to a number a person would say', () => {
    // So the scale stops jittering with every sample: a graph redrawn a second
    // later has to be the same graph, or the line dances against a moving axis.
    assert.equal(busiest([70]), 100);
    assert.equal(busiest([100]), 200);
    assert.equal(busiest([1_500_000]), 2_000_000);
    // The ladder goes 1, 2, 5, 10, so a peak that wants 5.6 gets 10 rather
    // than a rung invented for it. The line sits lower; the axis holds still.
    assert.equal(busiest([4_500_000]), 10_000_000);
    assert.equal(busiest([4_000_000]), 5_000_000);
  });

  it('keeps the busiest moment off the top edge', () => {
    // A peak drawn exactly at the ceiling is a line along the top, which reads
    // as clipped rather than as full.
    assert.ok(busiest([80]) > 80);
  });

  it('never answers zero, whatever it is given', () => {
    // An adapter carrying nothing is the ordinary state of most of them, and
    // dividing by that ceiling is what draws the line.
    assert.equal(busiest([]), 1);
    assert.equal(busiest([0, 0, 0]), 1);
  });
});
