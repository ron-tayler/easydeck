import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { guid } from './win32-com.js';
import { perApplicationId } from './win32-audio.js';

/*
 * The parts that can be checked without a sound card.
 *
 * Everything else in these modules talks to Windows, and a test that did would
 * change the machine it ran on — the default device is not a thing to flip
 * while somebody is streaming. Those paths were verified by hand against a
 * real system, writing values back that were already set.
 */

describe('a GUID as COM wants it', () => {
  it('lays the first three fields out little-endian, and the rest as written', () => {
    // The one that took the longest to get right: the first three fields are
    // numbers and the last eight are bytes, so half of it reverses and half
    // does not.
    const bytes = guid('BCDE0395-E52F-467C-8E3D-C4579291692E');

    assert.equal(bytes.length, 16);
    assert.equal(bytes.toString('hex'), '9503debc2fe57c468e3dc4579291692e');
  });

  it('takes the form with braces, which is how they are written down', () => {
    assert.deepEqual(
      guid('{870AF99C-171D-4F9E-AF0D-E63DF40C2BC9}'),
      guid('870af99c-171d-4f9e-af0d-e63df40c2bc9'),
    );
  });

  it('refuses something that is not one', () => {
    assert.throws(() => guid('not-a-guid'), /is not a GUID/);
  });
});

describe('naming a device for one application', () => {
  /*
   * Per-application routing does not take the endpoint id everything else
   * uses: it wants the *device interface* path, and nothing accepts the plain
   * form. Getting this wrong is silent — the call succeeds and the application
   * keeps playing where it was.
   */
  const endpoint = '{0.0.0.00000000}.{0cba5a2c-599b-4197-bf57-c21d480e4b31}';

  it('wraps an endpoint id in the interface path', () => {
    assert.equal(
      perApplicationId(endpoint, 'output'),
      `\\\\?\\SWD#MMDEVAPI#${endpoint}#{e6327cad-dcec-4949-ae8a-991e976a79d2}`,
    );
  });

  it('uses the capture class for recording', () => {
    assert.match(perApplicationId(endpoint, 'input'), /#\{2eef81be-33fa-4800-9670-1cd474972c3f\}$/);
  });

  it('passes an empty id through, which is how an application is let go', () => {
    // Empty means "whatever the system default is", and is the only way to
    // undo a routing once it has been set.
    assert.equal(perApplicationId('', 'output'), '');
  });
});
