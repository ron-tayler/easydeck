import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KEYBOARD_KEYS } from '@easydeck/engine';

import { loadKeyboardBackend, pressCombination, resolveKey } from './keyboard-actions.js';
import type { NutModule } from './keyboard-actions.js';

/**
 * Stands in for the native module, and nothing here presses a real key.
 *
 * A test that drove the actual keyboard would type into whatever window
 * happened to be in front — which is not a hypothetical: it happened while
 * this was being written.
 */
function fakeBackend(refuse?: number): { module: NutModule; log: string[] } {
  const log: string[] = [];

  const module = {
    Key: { A: 1, LeftControl: 2 },
    keyboard: {
      config: { autoDelayMs: 0 },
      async pressKey(key: number) {
        if (key === refuse) throw new Error('Invalid key flag specified');
        log.push(`down ${key}`);
      },
      async releaseKey(key: number) {
        log.push(`up ${key}`);
      },
      async type() {
        return undefined;
      },
    },
  } as unknown as NutModule;

  return { module, log };
}

describe('holding a combination down', () => {
  it('presses one key at a time and lets them go in reverse', async () => {
    /*
     * One per call is the whole of why hotkeys never worked. The backend's
     * signature is variadic and reads as though it takes a combination —
     * `pressKey(Ctrl, Shift, M)` — and it does not: everything past the first
     * argument comes back as "Invalid key flag specified". A single key went
     * through, so the action looked half-alive.
     */
    const { module, log } = fakeBackend();

    await pressCombination(module, [10, 20, 30]);

    assert.deepEqual(log, ['down 10', 'down 20', 'down 30', 'up 30', 'up 20', 'up 10']);
  });

  it('releases what it managed to press when a key is refused', async () => {
    // Leaving Ctrl stuck down would make the machine unusable until somebody
    // pressed it by hand.
    const { module, log } = fakeBackend(20);

    await assert.rejects(pressCombination(module, [10, 20, 30]), /Invalid key flag/);
    assert.deepEqual(log, ['down 10', 'up 10']);
  });
});

describe('asking the backend for a key', () => {
  it('resolves every key the catalogue offers', async () => {
    /*
     * The two tables — what a key is called in front of a person, and what
     * this backend calls it — live apart on purpose: a different native module
     * would replace the second and leave the first alone. This is what stops
     * them drifting, and it is not theoretical: a key offered in the list and
     * unknown to the backend is a button that does nothing when pressed, with
     * the editor having raised no objection.
     */
    const backend = await loadKeyboardBackend();
    if (!backend) {
      // The module is optional, and a machine without it still runs.
      return;
    }

    const missing = KEYBOARD_KEYS.filter((key) => {
      try {
        resolveKey(backend, key.id);
        return false;
      } catch {
        return true;
      }
    });

    assert.deepEqual(missing.map((key) => key.id), []);
  });

  it('refuses a key it does not have, by name', async () => {
    const backend = await loadKeyboardBackend();
    if (!backend) return;

    assert.throws(() => resolveKey(backend, 'anykey'), /There is no key called 'anykey'/);
    assert.throws(() => resolveKey(backend, '  '), /Empty key/);
  });

  it('still takes a name written the backend\'s own way', async () => {
    // Nothing offers these, and nothing gains from refusing a profile that
    // was written against the module directly.
    const backend = await loadKeyboardBackend();
    if (!backend) return;

    assert.equal(typeof resolveKey(backend, 'LeftSuper'), 'number');
    assert.equal(resolveKey(backend, 'ctrl'), resolveKey(backend, 'LeftControl'));
  });
});
