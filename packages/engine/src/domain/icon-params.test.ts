import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyIconParams, readIconParams, resolveIconParams } from './icon-params.js';

/** A gauge as somebody would actually write one: valid SVG, works in a browser. */
const NEEDLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <metadata id="easydeck">
    {"params":[
      {"name":"angle","label":{"en":"Needle"},"from":-120,"to":120,"default":"-120deg"},
      {"name":"colour","type":"color","default":"#e2483d"}
    ]}
  </metadata>
  <style>
    :root { --angle: -120deg; --colour: #e2483d; }
    .needle { fill: var(--colour); transform: rotate(var(--angle)); transform-origin: 48px 48px; }
  </style>
  <rect class="needle" x="46" y="14" width="4" height="36"/>
</svg>`;

describe('what an icon says about itself', () => {
  it('reads the parameters out of its metadata', () => {
    const params = readIconParams(NEEDLE);

    assert.equal(params.length, 2);
    assert.equal(params[0]?.name, 'angle');
    assert.equal(params[0]?.from, -120);
    assert.equal(params[1]?.type, 'color');
  });

  it('treats an ordinary icon as having none, and a broken one likewise', () => {
    // An icon that fails to load over a typo in a comment would be a poor
    // trade for a feature almost no icon uses.
    assert.deepEqual(readIconParams('<svg xmlns="http://www.w3.org/2000/svg"/>'), []);
    assert.deepEqual(
      readIconParams('<svg><metadata id="easydeck">{not json</metadata></svg>'),
      [],
    );
  });
});

describe('working out what a parameter comes to', () => {
  const params = readIconParams(NEEDLE);

  it('maps the variable\'s range onto the parameter\'s', () => {
    const values = resolveIconParams(
      params,
      { angle: { variable: 'hw.cpu', from: 0, to: 100 } },
      { 'hw.cpu': 50 },
    );

    assert.equal(values['angle'], '0', 'halfway along −120…120');
  });

  it('clamps at both ends, because the ends are what the picture was drawn against', () => {
    const binding = { angle: { variable: 'hw.cpu', from: 0, to: 100 } };

    assert.equal(resolveIconParams(params, binding, { 'hw.cpu': -20 })['angle'], '-120');
    assert.equal(resolveIconParams(params, binding, { 'hw.cpu': 250 })['angle'], '120');
  });

  it('takes a constant as it is, which is how a colour is chosen once', () => {
    const values = resolveIconParams(params, { colour: '#39d353' }, {});
    assert.equal(values['colour'], '#39d353');
  });

  it('looks a value up when the variable is an enum or a flag', () => {
    const binding = { colour: { variable: 'obs.streaming', map: { true: '#d4544a', false: '#3fae63' } } };

    assert.equal(resolveIconParams(params, binding, { 'obs.streaming': true })['colour'], '#d4544a');
    assert.equal(resolveIconParams(params, binding, { 'obs.streaming': false })['colour'], '#3fae63');
  });

  it('falls back to the icon\'s own default when there is nothing to read', () => {
    // What an icon looks like before it is wired to anything, and what it
    // goes back to when the plugin behind it stops publishing.
    const values = resolveIconParams(params, { angle: { variable: 'gone' } }, {});
    assert.equal(values['angle'], '-120deg');
  });
});

describe('putting the values into the picture', () => {
  it('rewrites the declarations and expands what reads them', () => {
    const drawn = applyIconParams(NEEDLE, { angle: '35deg', colour: '#39d353' });

    assert.match(drawn, /--angle: 35deg/);
    assert.match(drawn, /rotate\(35deg\)/, 'no rasterizer in reach understands var()');
    assert.match(drawn, /fill: #39d353/);
    assert.doesNotMatch(drawn, /var\(/, 'nothing left for a rasterizer to shrug at');
  });

  it('keeps a fallback for anything unresolved', () => {
    const svg = '<svg><rect fill="var(--missing, #888)" width="var(--gone)"/></svg>';
    const drawn = applyIconParams(svg, {});

    assert.match(drawn, /fill="#888"/);
    assert.match(drawn, /width="var\(--gone\)"/, 'left alone rather than blanked');
  });

  it('leaves an icon with no parameters exactly as it was', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#2F80ED"/></svg>';
    assert.equal(applyIconParams(svg, {}), svg);
  });
});
