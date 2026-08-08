import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ByteCache } from './byte-cache.js';

test('the oldest entry goes first when the limit is passed', () => {
  const cache = new ByteCache<string>(100);

  cache.set('a', 'first', 60);
  cache.set('b', 'second', 60);

  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 'second');
});

test('reading an entry makes it the newest', () => {
  const cache = new ByteCache<string>(100);

  cache.set('a', 'first', 40);
  cache.set('b', 'second', 40);
  cache.get('a');
  cache.set('c', 'third', 40);

  assert.equal(cache.get('a'), 'first', 'the entry just used was evicted');
  assert.equal(cache.get('b'), undefined);
});

test('size is counted in bytes, not entries', () => {
  // One entry is a four-kilobyte still or a hundred frames of an animation.
  // Counting entries makes any limit either useless or dangerous.
  const cache = new ByteCache<string>(1000);

  cache.set('small', 'x', 10);
  cache.set('huge', 'y', 900);

  assert.equal(cache.bytes, 910);
  assert.equal(cache.size, 2);
});

test('a pinned entry survives pressure that evicts everything else', () => {
  // A region on the panel must not lose its frames to the preparation of some
  // other region: the stutter that causes is invisible from the outside.
  const cache = new ByteCache<string>(100);

  cache.set('playing', 'frames', 60);
  cache.pin('playing');
  cache.set('other', 'work', 60);
  cache.set('more', 'work', 60);

  assert.equal(cache.get('playing'), 'frames');
});

test('releasing a pin makes the entry evictable again', () => {
  const cache = new ByteCache<string>(100);

  cache.set('a', 'first', 60);
  cache.pin('a');
  cache.set('b', 'second', 60);
  cache.unpin('a');

  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 'second');
});

test('keepPinned releases everything the new scene does not want', () => {
  const cache = new ByteCache<string>(100);

  cache.set('gone', 'old scene', 60);
  cache.pin('gone');
  cache.set('kept', 'new scene', 30);
  cache.pin('kept');

  cache.keepPinned(['kept']);
  cache.set('incoming', 'more', 60);

  assert.equal(cache.get('kept'), 'new scene');
  assert.equal(cache.get('gone'), undefined);
});

test('re-setting a key replaces its byte count rather than adding to it', () => {
  // Animations grow as frames are prepared, and are re-set on every one.
  const cache = new ByteCache<string>(1000);

  cache.set('growing', 'one frame', 100);
  cache.set('growing', 'two frames', 200);

  assert.equal(cache.bytes, 200);
});

test('everything pinned is allowed to exceed the limit', () => {
  // Going over while the panel is genuinely showing that much is the lesser
  // evil; it resolves the moment a region is released.
  const cache = new ByteCache<string>(50);

  cache.set('a', 'x', 40);
  cache.pin('a');
  cache.set('b', 'y', 40);
  cache.pin('b');

  assert.equal(cache.get('a'), 'x');
  assert.equal(cache.get('b'), 'y');
  assert.equal(cache.bytes, 80);
});

test('deleting frees the bytes', () => {
  const cache = new ByteCache<string>(100);

  cache.set('a', 'x', 60);
  cache.delete('a');

  assert.equal(cache.bytes, 0);
  assert.equal(cache.has('a'), false);
});
