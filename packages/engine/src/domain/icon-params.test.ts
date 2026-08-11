import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyIconParams,
  expandTransformOrigin,
  iconParamsProblem,
  readIconParams,
  resolveIconParams,
} from './icon-params.js';

/** A gauge as somebody would actually write one: valid SVG, works in a browser. */
const NEEDLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <metadata id="easydeck">
    {"params":[
      {"name":"angle","label":{"en":"Needle"},"from":-120,"to":120,"unit":"deg","default":0},
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

  it('accepts the other words people write for a type', () => {
    // `string` is what anyone who has written a JSON schema reaches for, and
    // `colour` is how our own documentation spells it. Refusing either showed
    // as a number box where a text box was wanted, which says nothing about
    // the spelling that caused it.
    const svg = `<svg><metadata id="easydeck">{"params":[
      {"name":"caption","type":"string"},
      {"name":"tint","type":"Colour"},
      {"name":"count","type":"int"}
    ]}</metadata></svg>`;

    assert.deepEqual(
      readIconParams(svg).map((param) => param.type),
      ['text', 'color', 'number'],
    );
  });

  it('says so when a type means nothing, rather than quietly counting', () => {
    const svg = '<svg><metadata id="easydeck">{"params":[{"name":"on","type":"boolean"}]}</metadata></svg>';

    assert.equal(readIconParams(svg)[0]?.type, undefined, 'left as the default');
    assert.match(iconParamsProblem(svg) ?? '', /unknown type "boolean"/);
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

    assert.equal(values['angle'], '0deg', 'halfway along −120…120, in the unit it asked for');
  });

  it('clamps at both ends, because the ends are what the picture was drawn against', () => {
    const binding = { angle: { variable: 'hw.cpu', from: 0, to: 100 } };

    assert.equal(resolveIconParams(params, binding, { 'hw.cpu': -20 })['angle'], '-120deg');
    assert.equal(resolveIconParams(params, binding, { 'hw.cpu': 250 })['angle'], '120deg');
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
    assert.equal(values['angle'], '0deg', 'the default, wearing the unit');
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

  it('expands properties the icon never offered as parameters', () => {
    /*
     * A picture uses properties it does not offer to configure — a colour it
     * always draws in — and those must be expanded too. librsvg does not
     * ignore an unresolved `var()`: it drops the declaration, and dropping a
     * fill means the shape is not drawn at all. A browser would resolve it
     * from `:root` and show the picture, so the panel has to as well.
     */
    const svg = `<svg><style>
      :root { --value: 1; --colour: #808080; }
      .bar { transform: scaleX(var(--value)); fill: var(--colour); }
    </style><rect class="bar" width="120" height="12"/></svg>`;

    const drawn = applyIconParams(svg, { value: '0.38' });

    assert.match(drawn, /scaleX\(0\.38\)/, 'what was bound');
    assert.match(drawn, /fill: #808080/, 'and what the icon kept to itself');
    assert.doesNotMatch(drawn, /var\(/);
  });

  it('leaves an icon with no parameters exactly as it was', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#2F80ED"/></svg>';
    assert.equal(applyIconParams(svg, {}), svg);
  });
});

describe('pinning a transform to the point it turns about', () => {
  /*
   * librsvg ignores `transform-origin` and turns everything about (0, 0), so a
   * needle pinned to the corner of its dial swings off the picture. Rewriting
   * it as move-there, turn, move-back is understood by both engines — and the
   * browser is given the same text, so the two cannot disagree.
   */
  const gauge = (origin: string) =>
    `<svg viewBox="0 0 128 128"><style>.bar{transform-origin: ${origin}; transform: rotate(90deg)}</style>` +
    '<rect class="bar" x="14" y="124" width="112" height="4"/></svg>';

  it('wraps the transform around a point given as lengths', () => {
    const drawn = expandTransformOrigin(gauge('126px 126px'));

    assert.match(drawn, /transform: translate\(126px, 126px\) rotate\(90deg\) translate\(-126px, -126px\)/);
    assert.doesNotMatch(drawn, /transform-origin/, 'or a browser would apply the offset twice');
  });

  it('measures a percentage against the viewBox, not the shape', () => {
    // Settled by measuring a browser: `50% 50%`, `center` and the viewBox
    // centre as a length all put a rectangle in exactly the same place.
    for (const origin of ['50% 50%', 'center', '64px 64px']) {
      assert.match(
        expandTransformOrigin(gauge(origin)),
        /translate\(64px, 64px\)/,
        `expected ${origin} to come to the middle of the viewBox`,
      );
    }
  });

  it('reads the keywords, whichever way round they are written', () => {
    assert.match(expandTransformOrigin(gauge('right bottom')), /translate\(128px, 128px\)/);
    assert.match(expandTransformOrigin(gauge('bottom right')), /translate\(128px, 128px\)/);
    assert.match(expandTransformOrigin(gauge('left top')), /translate\(0px, 0px\)/);
  });

  it('centres the other axis when only one value is given', () => {
    assert.match(expandTransformOrigin(gauge('10px')), /translate\(10px, 64px\)/);
  });

  it('leaves alone what it cannot work out, rather than guessing', () => {
    // A picture drawn slightly wrong beats one not drawn at all.
    assert.match(expandTransformOrigin(gauge('2em 2em')), /transform-origin: 2em 2em/);
    assert.match(
      expandTransformOrigin('<svg><style>.a{transform-origin: 50%; transform: scale(2)}</style></svg>'),
      /transform-origin: 50%/,
      'a percentage of nothing, since there is no viewBox to take it of',
    );
  });

  it('leaves a transform with no origin alone, because both engines agree', () => {
    const svg = '<svg viewBox="0 0 128 128"><style>.a{transform: rotate(90deg)}</style></svg>';
    assert.equal(expandTransformOrigin(svg), svg);
  });

  it('reaches an origin written on the element itself', () => {
    const svg =
      '<svg viewBox="0 0 96 96"><rect style="transform-origin: 48px 48px; transform: rotate(45deg)"/></svg>';

    assert.match(expandTransformOrigin(svg), /translate\(48px, 48px\) rotate\(45deg\) translate\(-48px, -48px\)/);
  });

  it('is applied by the substitution, so a bound rotation lands right too', () => {
    // Which is the path a key actually takes: the value arrives, then the
    // picture is pinned. Doing only the first is what drew an empty dial.
    const drawn = applyIconParams(
      '<svg viewBox="0 0 128 128"><style>:root{--value: 0deg}' +
        '.bar{transform-origin: 126px 126px; transform: rotate(var(--value))}</style></svg>',
      { value: '90deg' },
    );

    assert.match(drawn, /translate\(126px, 126px\) rotate\(90deg\) translate\(-126px, -126px\)/);
    assert.doesNotMatch(drawn, /var\(/);
  });
});
