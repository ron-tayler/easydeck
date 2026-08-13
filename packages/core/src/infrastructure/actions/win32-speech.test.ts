import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RATE_RANGE, VOLUME_RANGE, escapeXml } from './win32-speech.js';

/**
 * What can be checked without a voice.
 *
 * The speaking itself is COM on Windows and is verified by running it — the
 * vtable slots by writing a rate and reading the same number back, the text by
 * a phrase whose length is proportional to what was said. Neither of those is
 * a thing a test on any machine can do.
 *
 * What is left here is the escaping, which is the only place a value somebody
 * else controls is put into something with syntax.
 */

describe('escaping for SAPI markup', () => {
  it('covers the five characters XML cares about', () => {
    assert.equal(escapeXml('a & b'), 'a &amp; b');
    assert.equal(escapeXml('<b>'), '&lt;b&gt;');
    assert.equal(escapeXml(`"quoted" and 'quoted'`), '&quot;quoted&quot; and &apos;quoted&apos;');
  });

  it('escapes the ampersand first, so nothing is escaped twice', () => {
    // The other order turns `<` into `&lt;` and then into `&amp;lt;`, which is
    // read out as the letters rather than as the sign.
    assert.equal(escapeXml('<'), '&lt;');
    assert.equal(escapeXml('&lt;'), '&amp;lt;');
  });

  it('leaves alone everything that is not one of the five', () => {
    // Cyrillic in particular: it goes into SAPI as UTF-16 and needs nothing
    // done to it, which is the whole reason this no longer goes near a shell.
    assert.equal(escapeXml('Процессор на 40%'), 'Процессор на 40%');
  });

  it('cannot be used to smuggle a second voice tag in', () => {
    /*
     * The text and the voice are put into one string, so a label reading
     * `<voice required="Name=…"/>` must arrive as those characters rather than
     * as markup — otherwise a variable holding a chat message could change
     * which voice is speaking.
     */
    const smuggled = escapeXml('<voice required="Name=Other"/>hello');

    assert.doesNotMatch(smuggled, /<voice/);
    assert.match(smuggled, /&lt;voice/);
  });
});

describe('the ranges SAPI takes', () => {
  it('are the ones the form offers', () => {
    // Declared here and used in the manifest, so a field cannot offer a number
    // the voice would refuse.
    assert.deepEqual(RATE_RANGE, { min: -10, max: 10 });
    assert.deepEqual(VOLUME_RANGE, { min: 0, max: 100 });
  });
});
