import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ProfileDefinition } from './profile.js';
import { validateProfile } from './validate-profile.js';

function profile(overrides: Partial<ProfileDefinition> = {}): ProfileDefinition {
  return {
    id: 'p',
    name: 'Profile',
    layout: { rows: 3, cols: 5 },
    pages: [
      {
        id: 'main',
        buttons: [{ id: 'b1', key: 0, states: [{ id: 'default', visual: { background: '#000' } }] }],
      },
    ],
    ...overrides,
  };
}

describe('validateProfile', () => {
  it('accepts a well-formed profile', () => {
    assert.doesNotThrow(() => validateProfile(profile()));
  });

  it('rejects a key outside the layout', () => {
    const bad = profile({
      pages: [{ id: 'main', buttons: [{ id: 'b', key: 15, states: [{ id: 's', visual: {} }] }] }],
    });
    assert.throws(() => validateProfile(bad), /outside a 3x5 layout/);
  });

  it('rejects two buttons claiming the same key', () => {
    const bad = profile({
      pages: [
        {
          id: 'main',
          buttons: [
            { id: 'a', key: 2, states: [{ id: 's', visual: {} }] },
            { id: 'b', key: 2, states: [{ id: 's', visual: {} }] },
          ],
        },
      ],
    });
    assert.throws(() => validateProfile(bad), /claimed by more than one button/);
  });

  it('rejects duplicate ids', () => {
    const dupPage = profile({ pages: [profile().pages[0]!, profile().pages[0]!] });
    assert.throws(() => validateProfile(dupPage), /Duplicate page id/);

    const dupState = profile({
      pages: [
        {
          id: 'main',
          buttons: [{ id: 'b', key: 0, states: [{ id: 's', visual: {} }, { id: 's', visual: {} }] }],
        },
      ],
    });
    assert.throws(() => validateProfile(dupState), /Duplicate state id/);
  });

  it('rejects an initial state or page that does not exist', () => {
    const badState = profile({
      pages: [
        {
          id: 'main',
          buttons: [{ id: 'b', key: 0, initialStateId: 'nope', states: [{ id: 's', visual: {} }] }],
        },
      ],
    });
    assert.throws(() => validateProfile(badState), /which it does not define/);

    assert.throws(() => validateProfile(profile({ initialPageId: 'nope' })), /does not exist/);
  });

  it('rejects actions bound to an unknown event', () => {
    const bad = profile({
      pages: [
        {
          id: 'main',
          buttons: [
            {
              id: 'b',
              key: 0,
              states: [{ id: 's', visual: {}, actions: { doubleClick: [] } as never }],
            },
          ],
        },
      ],
    });
    assert.throws(() => validateProfile(bad), /unknown event 'doubleClick'/);
  });

  it('rejects a button with no states and a profile with no pages', () => {
    const noStates = profile({
      pages: [{ id: 'main', buttons: [{ id: 'b', key: 0, states: [] }] }],
    });
    assert.throws(() => validateProfile(noStates), /has no states/);
    assert.throws(() => validateProfile(profile({ pages: [] })), /has no pages/);
  });
});
