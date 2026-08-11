import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { freeName, slugForName } from './profile-slug.js';

describe('what a profile is filed as', () => {
  it('transliterates, so a Russian name is still a recognisable folder', () => {
    assert.equal(slugForName('Стрим Игры'), 'strim-igry');
    assert.equal(slugForName('Щука'), 'schuka');
    assert.equal(slugForName('Подъём'), 'podem');
  });

  it('keeps accents readable rather than dropping the letter', () => {
    assert.equal(slugForName('Café Münchén'), 'cafe-munchen');
  });

  it('never produces something that is not a folder name', () => {
    assert.equal(slugForName('  Main  '), 'main');
    assert.equal(slugForName('a/b\\c'), 'a-b-c');
    assert.equal(slugForName('...'), 'profile', 'a name with nothing usable in it');
    assert.equal(slugForName('🎮🎮'), 'profile');
    assert.equal(slugForName('NUL'), 'nul-profile', 'Windows refuses this one outright');
    assert.equal(slugForName('x'.repeat(80)).length, 48);
  });
});

describe('finding a free one', () => {
  const none = async () => false;

  it('takes the plain name when nothing is in the way', async () => {
    assert.equal(await freeName('Stream', none), 'stream');
  });

  it('numbers a name somebody else already has', async () => {
    const taken = async (candidate: string) => candidate === 'stream';
    assert.equal(await freeName('Stream', taken), 'stream-2');
  });

  it('stays where it is when the name has not changed', async () => {
    // Otherwise a profile saved twice would walk to stream-2, stream-3, one
    // folder per keystroke — which is exactly the accident this guards.
    const taken = async (candidate: string) => candidate === 'stream';
    assert.equal(await freeName('Stream', taken, 'stream'), 'stream');
  });

  it('moves back to the plain name once it is free', async () => {
    assert.equal(await freeName('Stream', none, 'stream-2'), 'stream');
  });
});
