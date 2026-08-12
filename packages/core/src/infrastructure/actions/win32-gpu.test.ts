import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadFromEngines, parseTemperature, usedFromAdapters } from './win32-gpu.js';

/*
 * The arithmetic between the counters and the number on a key.
 *
 * Everything else in that module talks to Windows, and was checked by hand
 * against this machine: an RTX 3060 reporting 12 GiB total, 3.5 GiB in use and
 * 46 degrees, agreeing with `nvidia-smi` on all three.
 */

const engine = (pid: number, type: string, value: number) => ({
  name: `pid_${pid}_luid_0x00000000_0x00014E82_phys_0_eng_0_engtype_${type}`,
  value,
});

describe('the load, out of hundreds of instances', () => {
  it('adds up the programs using one engine', () => {
    // Every program has an instance of its own; the engine's load is their sum.
    const load = loadFromEngines([engine(1, '3D', 4.7), engine(2, '3D', 1.9), engine(3, '3D', 0.4)]);

    assert.equal(load, 7);
  });

  it('takes the busiest engine rather than adding the engines together', () => {
    /*
     * The reason this is not one sum: a machine playing a video while a game
     * runs has both engines busy, and 3D plus VideoDecode plus Copy would
     * report a card at over a hundred percent. The task manager shows the
     * busiest, and so does this.
     */
    const load = loadFromEngines([
      engine(1, '3D', 40),
      engine(2, '3D', 20),
      engine(3, 'VideoDecode', 75),
      engine(4, 'Copy', 5),
    ]);

    assert.equal(load, 75);
  });

  it('never reports more than the whole card', () => {
    assert.equal(loadFromEngines([engine(1, '3D', 70), engine(2, '3D', 60)]), 100);
  });

  it('answers nothing when the counters gave nothing', () => {
    // A driver restarting, or a card asleep. Nothing is not zero: a key
    // showing 0% would be a claim, and this makes none.
    assert.equal(loadFromEngines([]), undefined);
  });

  it('copes with an instance name it does not recognise', () => {
    assert.equal(loadFromEngines([{ name: 'something_else', value: 12.4 }]), 12);
  });
});

describe('the memory, out of every adapter Windows lists', () => {
  it('takes the card in use rather than the sum of all of them', () => {
    /*
     * This machine reports three adapters: the card, a headset's virtual
     * monitor and a screen-sharing one. Adding them together would answer a
     * question nobody asked; the biggest is the one somebody means.
     */
    const used = usedFromAdapters([
      { name: 'luid_0x00000000_0x00014E82_phys_0', value: 3_744_000_000 },
      { name: 'luid_0x00000000_0x00019205_phys_0', value: 0 },
    ]);

    assert.equal(used, 3_744_000_000);
  });

  it('answers nothing when there are no adapters', () => {
    assert.equal(usedFromAdapters([]), undefined);
  });
});

describe('the temperature nvidia-smi prints', () => {
  it('reads the plain number it is asked for', () => {
    assert.equal(parseTemperature('46\n'), 46);
  });

  it('takes the first card when there are several', () => {
    assert.equal(parseTemperature('61\r\n58\r\n'), 61);
  });

  it('answers nothing for output that is not a number', () => {
    // A driver that printed a warning, or a locale that answered in words.
    assert.equal(parseTemperature('N/A\n'), undefined);
    assert.equal(parseTemperature(''), undefined);
  });
});
