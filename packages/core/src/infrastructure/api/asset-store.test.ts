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
});
