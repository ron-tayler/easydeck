import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ButtonVisual } from '../domain/visual.js';
import { CachingKeyRenderer } from './caching-renderer.js';
import type { AnimatedFrame, KeyRendererPort } from './ports/renderer-port.js';

class CountingRenderer implements KeyRendererPort {
  renders = 0;
  frameRenders = 0;
  fail = false;

  async render(visual: ButtonVisual): Promise<Uint8Array> {
    this.renders += 1;
    if (this.fail) throw new Error('nope');
    return Buffer.from(JSON.stringify(visual));
  }

  async renderFrames(visual: ButtonVisual): Promise<readonly AnimatedFrame[] | undefined> {
    this.frameRenders += 1;
    if (!visual.icon?.source.startsWith('gif')) return undefined;
    return [
      { image: new Uint8Array([1]), delayMs: 40 },
      { image: new Uint8Array([2]), delayMs: 40 },
    ];
  }
}

const still: ButtonVisual = { background: '#123456', label: { text: 'hi' } };
const animated: ButtonVisual = { icon: { source: 'gif:one' } };

describe('caching what a key rendered to', () => {
  it('renders one visual once, however often it is asked for', async () => {
    const inner = new CountingRenderer();
    const cache = new CachingKeyRenderer(inner);

    const first = await cache.render(still);
    const second = await cache.render({ ...still });

    assert.equal(inner.renders, 1, 'the second ask came from the cache');
    assert.deepEqual([...first], [...second]);
  });

  it('still renders a different visual', async () => {
    const inner = new CountingRenderer();
    const cache = new CachingKeyRenderer(inner);

    await cache.render(still);
    await cache.render({ ...still, background: '#654321' });

    assert.equal(inner.renders, 2);
  });

  /**
   * The case this exists for: every key of a merged region asks for the same
   * animation at once, and each ask is a full GIF decode.
   */
  it('decodes an animation once even when several keys ask at the same time', async () => {
    const inner = new CountingRenderer();
    const cache = new CachingKeyRenderer(inner);

    const all = await Promise.all([
      cache.renderFrames(animated),
      cache.renderFrames({ ...animated }),
      cache.renderFrames({ ...animated }),
    ]);

    assert.equal(inner.frameRenders, 1, 'concurrent asks share one in-flight render');
    for (const frames of all) assert.equal(frames?.length, 2);
  });

  it('remembers that something is not an animation, which can cost a file read', async () => {
    const inner = new CountingRenderer();
    const cache = new CachingKeyRenderer(inner);

    assert.equal(await cache.renderFrames(still), undefined);
    assert.equal(await cache.renderFrames({ ...still }), undefined);

    assert.equal(inner.frameRenders, 1);
  });

  /** A blank key until restart would be a poor way to report a hiccup. */
  it('does not remember a failure', async () => {
    const inner = new CountingRenderer();
    const cache = new CachingKeyRenderer(inner);

    inner.fail = true;
    await assert.rejects(cache.render(still));

    inner.fail = false;
    await assert.doesNotReject(cache.render(still));
    assert.equal(inner.renders, 2, 'it tried again rather than serving the error');
  });

  it('drops the least recently used entry once full', async () => {
    const inner = new CountingRenderer();
    const cache = new CachingKeyRenderer(inner, 2);

    await cache.render({ background: '#1' });
    await cache.render({ background: '#2' });
    // Touching the first makes the second the oldest.
    await cache.render({ background: '#1' });
    await cache.render({ background: '#3' });

    assert.equal(inner.renders, 3);

    await cache.render({ background: '#1' });
    assert.equal(inner.renders, 3, 'the recently used one survived');

    await cache.render({ background: '#2' });
    assert.equal(inner.renders, 4, 'the oldest was evicted');
  });
});
