import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  iconPaletteProblem,
  readIconPalette,
  resolveIconColors,
  usesCurrentColor,
  withRootColor,
} from './icon-colors.js';
import { drawableIcon } from './icon-source.js';

/** The simple case, and the one almost every icon is: one ink, no metadata. */
const GLYPH = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M3 3h18v18H3z"/></svg>`;

/** A picture that names its inks, one of them following the main one. */
const TWO_TONE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <metadata id="easydeck">
    {"palette":[
      {"name":"body","label":{"en":"Body"},"default":"#8899aa"},
      {"name":"dot","default":"currentColor"}
    ]}
  </metadata>
  <style>:root { --body: #8899aa; --dot: currentColor; }</style>
  <rect fill="var(--body)" width="24" height="24"/>
  <circle fill="var(--dot)" cx="12" cy="12" r="4"/>
</svg>`;

describe('an icon that takes a colour', () => {
  it('is recognised by the keyword alone, in any case', () => {
    assert.equal(usesCurrentColor(GLYPH), true);
    assert.equal(usesCurrentColor(GLYPH.replace('currentColor', 'CURRENTCOLOR')), true);
    assert.equal(usesCurrentColor('<svg><path fill="#fff"/></svg>'), false);
  });

  it('is given a colour to inherit rather than being rewritten', () => {
    const out = withRootColor(GLYPH, '#ff5555');

    assert.match(out, /<svg[^>]*style="color:#ff5555"/);
    // The artwork itself is untouched: this is the cascade doing the work,
    // which is the whole reason the file needs nothing of ours in it.
    assert.match(out, /fill="currentColor"/);
  });

  it('appends to a style the picture already had, so ours is the one that wins', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="color:#000;opacity:.9"><path fill="currentColor"/></svg>`;

    assert.match(withRootColor(svg, '#0f0'), /style="color:#000;opacity:\.9;color:#0f0"/);
  });

  it('refuses anything that could close the attribute', () => {
    // Not escaped but refused: a colour picker cannot produce this, and a
    // profile carrying it is not describing a colour by any reading.
    assert.equal(withRootColor(GLYPH, '#fff" onload="x'), GLYPH);
    assert.equal(withRootColor(GLYPH, ''), GLYPH);
  });
});

describe('an icon that names its inks', () => {
  it('reads them, and reads nothing from an icon that names none', () => {
    const palette = readIconPalette(TWO_TONE);

    assert.equal(palette.length, 2);
    assert.equal(palette[0]?.name, 'body');
    assert.equal(palette[0]?.label?.en, 'Body');
    assert.deepEqual(readIconPalette(GLYPH), []);
  });

  it('falls back to what the picture was drawn in', () => {
    assert.deepEqual(resolveIconColors(readIconPalette(TWO_TONE), undefined), {
      body: '#8899aa',
      dot: 'currentColor',
    });
  });

  it('takes what was chosen over what was drawn', () => {
    assert.deepEqual(resolveIconColors(readIconPalette(TWO_TONE), { body: '#123456' }), {
      body: '#123456',
      dot: 'currentColor',
    });
  });
});

describe('what the icon is told is wrong with it', () => {
  it('says nothing about an icon that declares nothing', () => {
    assert.equal(iconPaletteProblem(GLYPH), undefined);
    assert.equal(iconPaletteProblem(TWO_TONE), undefined);
  });

  it('catches a name claimed by both a colour and a parameter', () => {
    // The collision that matters: both write the same custom property, from
    // two different controls, and the later one would win in silence.
    const svg = `<svg><metadata id="easydeck">{"palette":[{"name":"tint"}],"params":[{"name":"tint","type":"color"}]}</metadata></svg>`;

    assert.match(iconPaletteProblem(svg) ?? '', /both a palette colour and a parameter/);
  });

  it('catches a colour that claims the icon\'s own ink', () => {
    const svg = `<svg><metadata id="easydeck">{"palette":[{"name":"currentColor"}]}</metadata></svg>`;

    assert.match(iconPaletteProblem(svg) ?? '', /cannot be a palette name/);
    // And it is refused when read, not merely complained about.
    assert.deepEqual(readIconPalette(svg), []);
  });

  it('catches the same colour declared twice, and a palette that is not a list', () => {
    const twice = `<svg><metadata id="easydeck">{"palette":[{"name":"a"},{"name":"a"}]}</metadata></svg>`;
    const wrong = `<svg><metadata id="easydeck">{"palette":{"a":"#fff"}}</metadata></svg>`;

    assert.match(iconPaletteProblem(twice) ?? '', /declared twice/);
    assert.match(iconPaletteProblem(wrong) ?? '', /not an array/);
  });

  it('leaves a broken block to the parameters, so it is not said twice', () => {
    assert.equal(iconPaletteProblem('<svg><metadata id="easydeck">{ not json</metadata></svg>'), undefined);
  });
});

describe('the picture handed to whoever draws it', () => {
  it('carries the ink of a one-colour icon', () => {
    assert.match(drawableIcon({ source: GLYPH, color: '#00ff00' }), /style="color:#00ff00"/);
  });

  it('leaves an icon alone when there is nothing to do to it', () => {
    // The overwhelming majority of keys: a photograph, or a glyph with no
    // colour chosen. Nothing is parsed, hashed or rewritten for them.
    const plain = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#123"/></svg>';

    assert.equal(drawableIcon({ source: plain, color: '#f00' }), plain);
    assert.equal(drawableIcon({ source: GLYPH }), GLYPH);
  });

  it('substitutes the named inks and lets one of them follow the main one', () => {
    const out = drawableIcon({ source: TWO_TONE, color: '#ff0000', colors: { body: '#0000ff' } });

    assert.match(out, /fill="#0000ff"/);
    // The dot keeps `currentColor` in the markup and is resolved by the same
    // cascade as everything else — which is why this costs no special case.
    assert.match(out, /fill="currentColor"/);
    assert.match(out, /style="color:#ff0000"/);
  });

  it('ignores an ink left over from a picture that does not read one', () => {
    const fixed = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="var(--x)"/></svg>';

    assert.doesNotMatch(drawableIcon({ source: fixed, color: '#f00' }), /style="color:/);
  });

  it('works on the data URL a profile actually stores', () => {
    const url = `data:image/svg+xml;base64,${Buffer.from(GLYPH).toString('base64')}`;
    const out = drawableIcon({ source: url, color: '#abcdef' });

    assert.ok(out.startsWith('data:image/svg+xml;base64,'));
    assert.match(Buffer.from(out.split(',')[1] ?? '', 'base64').toString(), /style="color:#abcdef"/);
  });
});
