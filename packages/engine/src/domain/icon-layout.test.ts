import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { composeIcon, isComposedIcon, readIconLayers, readLayerSource } from './icon-layout.js';
import { iconParamsProblem, readIconParams } from './icon-params.js';
import { iconPaletteProblem, readIconPalette } from './icon-colors.js';
import { drawableIcon } from './icon-source.js';

/** A glyph that takes its colour from outside, as every library icon does. */
const GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M3 3h18v18H3z"/></svg>`;

/** A picture that declares both kinds of thing, and names them plainly. */
const GAUGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <metadata id="easydeck">
    {"params":[{"name":"angle","label":{"en":"Needle"},"from":-120,"to":120,"unit":"deg","default":0}],
     "palette":[{"name":"ink","label":{"en":"Ink"},"default":"#e2483d"}]}
  </metadata>
  <style>:root { --angle: 0deg; --ink: #e2483d; }</style>
  <linearGradient id="fade"><stop stop-color="#fff"/></linearGradient>
  <rect id="dial" fill="url(#fade)" width="96" height="96"/>
  <rect class="needle" style="fill: var(--ink); transform: rotate(var(--angle)); transform-origin: 50% 50%" x="46" y="14" width="4" height="36"/>
</svg>`;

const A_PNG = 'data:image/png;base64,iVBORw0KGgo=';

/**
 * An outline icon of the kind people download by the thousand.
 *
 * `fill="none"` on the root is the whole of what makes it an outline: the path
 * under it sets a stroke and no fill, so without that word it takes the
 * default, which is black.
 */
const OUTLINE = `<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5 3h14v18H5z" stroke="#000000" stroke-width="2" stroke-linecap="round"/>
</svg>`;

describe('placing one picture', () => {
  it('records where it was put, and says the picture is composed', () => {
    const composed = composeIcon([{ source: GLYPH, x: 20, y: 20, width: 60, height: 60 }]);
    const layers = readIconLayers(composed);

    assert.equal(layers.length, 1);
    assert.deepEqual(layers[0], { id: 'l1', x: 20, y: 20, width: 60, height: 60 });
    assert.equal(isComposedIcon(composed), true);
    assert.equal(isComposedIcon(GLYPH), false);
  });

  it('keeps the artwork inline, so its colour still answers', () => {
    const composed = composeIcon([{ source: GLYPH, x: 0, y: 0, width: 100, height: 100 }]);

    // Inlined rather than referenced: through an <image> this would be a
    // document of its own, and `currentColor` would have nothing to inherit.
    assert.match(composed, /fill="currentColor"/);
    assert.match(drawableIcon({ source: composed, color: '#00ff00' }), /style="color:#00ff00"/);
  });

  it('carries a raster as an image, since there is nothing in it to rename', () => {
    const composed = composeIcon([{ source: A_PNG, x: 10, y: 10, width: 40, height: 40 }]);

    assert.match(composed, /<image id="l1"[^>]*href="data:image\/png/);
    assert.match(composed, /preserveAspectRatio="xMidYMid meet"/);
  });

  it('hands the artwork back for another go at placing it', () => {
    const composed = composeIcon([{ source: GLYPH, x: 5, y: 5, width: 90, height: 90 }]);
    const back = readLayerSource(composed, 'l1');

    assert.match(back ?? '', /viewBox="0 0 24 24"/);
    assert.match(back ?? '', /fill="currentColor"/);
    assert.match(back ?? '', /M3 3h18v18H3z/);
  });

  it('keeps what the artwork said on its own root', () => {
    const composed = composeIcon([{ source: OUTLINE, x: 0, y: 0, width: 100, height: 100 }]);

    // Without this the picture arrives as a solid black blob, because every
    // path under it takes the fill nobody set.
    assert.match(composed, /<svg id="l1"[^>]*fill="none"/);
    // The placement decides these, so they cannot come from the artwork: an
    // 800px picture placed in a hundred-unit canvas would cover the whole key
    // eight times over.
    assert.doesNotMatch(composed, /<svg id="l1"[^>]*width="800px"/);
  });

  it('gives the root back too, so a second go is on the same picture', () => {
    const composed = composeIcon([{ source: OUTLINE, x: 10, y: 10, width: 80, height: 80 }]);

    assert.match(readLayerSource(composed, 'l1') ?? '', /fill="none"/);
  });

  it('gives a raster layer back as the picture it was', () => {
    const composed = composeIcon([{ source: A_PNG, x: 0, y: 0, width: 100, height: 100 }]);

    assert.equal(readLayerSource(composed, 'l1'), A_PNG);
  });
});

describe('the three things one metadata block can carry', () => {
  it('does not call a picture broken for declaring only where it sits', () => {
    // The block was once about parameters and nothing else, so one without
    // them could only mean a misspelling. A picture merely placed on the key
    // was being announced as broken, with a gear beside it opening a window to
    // say the picture had declared nothing.
    const placed = composeIcon([{ source: GLYPH, x: 25, y: 25, width: 50, height: 50 }]);

    assert.equal(iconParamsProblem(placed), undefined);
    assert.equal(iconPaletteProblem(placed), undefined);
    assert.deepEqual(readIconParams(placed), []);
  });

  it('still complains about a "params" that is there and wrong', () => {
    const svg = `<svg><metadata id="easydeck">{"params":{"angle":0}}</metadata></svg>`;

    assert.match(iconParamsProblem(svg) ?? '', /not an array/);
  });
});

describe('a layer that declares things', () => {
  it('has its declarations lifted into the wrapper and its own block removed', () => {
    const composed = composeIcon([{ source: GAUGE, x: 0, y: 0, width: 100, height: 100 }]);

    // One block, one id. Two would be invalid, and the reader only ever sees
    // whichever came first.
    assert.equal(composed.match(/id="easydeck"/g)?.length, 1);

    assert.deepEqual(
      readIconParams(composed).map((param) => param.name),
      ['l1-angle'],
    );
    assert.deepEqual(
      readIconPalette(composed).map((slot) => slot.name),
      ['l1-ink'],
    );
  });

  it('numbers the label, so two of the same picture are told apart', () => {
    const composed = composeIcon([
      { source: GAUGE, x: 0, y: 0, width: 50, height: 100 },
      { source: GAUGE, x: 50, y: 0, width: 50, height: 100 },
    ]);

    assert.deepEqual(
      readIconParams(composed).map((param) => param.label?.en),
      ['1. Needle', '2. Needle'],
    );
  });

  it('keeps what the parameter meant, not only what it is called', () => {
    const composed = composeIcon([{ source: GAUGE, x: 0, y: 0, width: 100, height: 100 }]);
    const angle = readIconParams(composed)[0];

    assert.equal(angle?.from, -120);
    assert.equal(angle?.to, 120);
    assert.equal(angle?.unit, 'deg');
  });
});

describe('two of the same picture in one file', () => {
  const composed = composeIcon([
    { source: GAUGE, x: 0, y: 0, width: 50, height: 100 },
    { source: GAUGE, x: 50, y: 0, width: 50, height: 100 },
  ]);

  it('names their properties apart, so one needle can move without the other', () => {
    const names = readIconParams(composed).map((param) => param.name);
    assert.deepEqual(names, ['l1-angle', 'l2-angle']);

    const drawn = drawableIcon({ source: composed, values: { 'l1-angle': '90deg', 'l2-angle': '0deg' } });
    assert.match(drawn, /rotate\(90deg\)/);
    assert.match(drawn, /rotate\(0deg\)/);
  });

  it('names their elements apart, so one gradient is not drawn twice', () => {
    // Measured on librsvg: two elements sharing an id resolve to the first,
    // and the second layer silently wears the first one's fill.
    assert.match(composed, /id="l1-fade"/);
    assert.match(composed, /id="l2-fade"/);
    assert.match(composed, /url\(#l1-fade\)/);
    assert.match(composed, /url\(#l2-fade\)/);
  });

  it('leaves no name shared between them', () => {
    const shared = ['--angle', '--ink', 'id="dial"', 'id="fade"', 'url(#fade)'];
    for (const name of shared) assert.equal(composed.includes(name), false, `${name} survived`);
  });

  it('bakes each rotation about its own middle', () => {
    // The origin is a percentage of the picture's own viewBox. Left to be
    // worked out later it would be resolved against the wrapper's, which is a
    // different picture's idea of where the middle is.
    assert.equal(composed.includes('transform-origin'), false);
    assert.match(composed, /translate\(48px, 48px\)/);
  });
});
