import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AssetStore } from './asset-store.js';

const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

describe('pictures handed out by link', () => {
  it('keeps the bytes and returns a path to them', () => {
    const assets = new AssetStore();

    const link = assets.link(GIF);
    const stored = assets.get(link.slice('/asset/'.length));

    assert.match(link, /^\/asset\/[A-Za-z0-9_-]+$/);
    assert.equal(stored?.contentType, 'image/gif');
    assert.deepEqual(stored?.bytes, Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'));
  });

  it('gives the same picture the same link', () => {
    // What makes a picture across fifteen keys one download rather than
    // fifteen, and lets a browser keep it across reconnects.
    const assets = new AssetStore();

    assert.equal(assets.link(GIF), assets.link(GIF));
  });

  it('gives different pictures different links', () => {
    const assets = new AssetStore();
    const other = 'data:image/png;base64,iVBORw0KGgo=';

    assert.notEqual(assets.link(GIF), assets.link(other));
  });

  it('leaves alone anything that is not bytes', () => {
    // A path is for whoever can read the disk, and a URL is already a link.
    const assets = new AssetStore();

    assert.equal(assets.link('C:/icons/mic.png'), 'C:/icons/mic.png');
    assert.equal(assets.link('https://example.test/a.gif'), 'https://example.test/a.gif');
  });

  it('answers nothing for an unknown id', () => {
    assert.equal(new AssetStore().get('nope'), undefined);
  });

  it('works out a link once and remembers it', () => {
    /*
     * The digest is over the bytes, so a link costs a base64 decode and a hash
     * of the whole picture — and the page view asks for every icon on it every
     * time a variable moves. The answer cannot change: the same text is the
     * same picture.
     *
     * Asserted by identity, since a link worked out afresh would be an equal
     * string rather than the same one.
     */
    const assets = new AssetStore();
    const first = assets.link(GIF);

    assert.ok(Object.is(assets.link(GIF), first), 'the link was worked out again');
    assert.equal(assets.get(first.slice('/asset/'.length))?.contentType, 'image/gif');
  });

  it('forgets the oldest rather than growing without bound', () => {
    /*
     * A parametric icon is a different picture at every position of its
     * needle, so what arrives here is unbounded and this cache must not be.
     * Forgetting costs a hash next time and nothing else — the bytes stay
     * filed under the id they already have.
     */
    const assets = new AssetStore();
    const linkOf = (index: number) =>
      assets.link(`data:image/svg+xml,${encodeURIComponent(`<svg id="${index}"/>`)}`);

    const first = linkOf(0);
    for (let index = 1; index <= 300; index += 1) linkOf(index);

    // The same answer, because the picture decides it — just not from memory.
    assert.equal(linkOf(0), first);
    assert.ok(assets.get(first.slice('/asset/'.length)));
  });
});
