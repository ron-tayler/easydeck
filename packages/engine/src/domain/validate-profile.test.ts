import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_PAGES_PER_FOLDER, PROFILE_FORMAT_VERSION } from './profile.js';
import type { FolderDefinition, PageDefinition, ProfileDefinition } from './profile.js';
import { validateProfile } from './validate-profile.js';

function page(id: string, buttons: PageDefinition['buttons'] = []): PageDefinition {
  return { id, buttons };
}

function folder(id: string, overrides: Partial<FolderDefinition> = {}): FolderDefinition {
  return { id, name: id, pages: [page(`${id}-1`)], ...overrides };
}

function profile(overrides: Partial<ProfileDefinition> = {}): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'p',
    name: 'Profile',
    layout: { rows: 3, cols: 5 },
    root: folder('root', {
      pages: [page('main', [{ id: 'b1', key: 0, states: [{ id: 'default', visual: {} }] }])],
      folders: [folder('tools')],
    }),
    ...overrides,
  };
}

describe('validateProfile', () => {
  it('accepts a well-formed profile with nested folders', () => {
    assert.doesNotThrow(() => validateProfile(profile()));
  });

  it('rejects a profile without a root folder', () => {
    assert.throws(
      () => validateProfile({ ...profile(), root: undefined } as unknown as ProfileDefinition),
      /has no root folder/,
    );
  });

  it('rejects a folder with no pages', () => {
    const bad = profile({ root: folder('root', { pages: [] }) });
    assert.throws(() => validateProfile(bad), /has no pages/);
  });

  // Adding a page is cheaper than adding a folder on purpose, but a scene
  // with dozens of pages stops being navigable.
  it('rejects more pages than the cap allows', () => {
    const pages = Array.from({ length: MAX_PAGES_PER_FOLDER + 1 }, (_, i) => page(`p${i}`));
    assert.throws(() => validateProfile(profile({ root: folder('root', { pages }) })), /maximum is 16/);
    assert.doesNotThrow(() =>
      validateProfile(profile({ root: folder('root', { pages: pages.slice(0, MAX_PAGES_PER_FOLDER) }) })),
    );
  });

  // Navigation actions reference ids globally, so a duplicate anywhere in the
  // tree would make "go to that page" ambiguous.
  it('rejects duplicate ids anywhere in the tree', () => {
    const dupFolder = profile({ root: folder('root', { folders: [folder('dup'), folder('dup')] }) });
    assert.throws(() => validateProfile(dupFolder), /Duplicate folder id 'dup'/);

    const dupPage = profile({
      root: folder('root', { pages: [page('same')], folders: [folder('child', { pages: [page('same')] })] }),
    });
    assert.throws(() => validateProfile(dupPage), /Duplicate page id 'same'/);
  });

  it('rejects a key outside the layout and two buttons on one key', () => {
    const outside = profile({
      root: folder('root', {
        pages: [page('main', [{ id: 'b', key: 15, states: [{ id: 's', visual: {} }] }])],
      }),
    });
    assert.throws(() => validateProfile(outside), /outside a 3x5 layout/);

    const collision = profile({
      root: folder('root', {
        pages: [
          page('main', [
            { id: 'a', key: 2, states: [{ id: 's', visual: {} }] },
            { id: 'b', key: 2, states: [{ id: 's', visual: {} }] },
          ]),
        ],
      }),
    });
    assert.throws(() => validateProfile(collision), /claimed by more than one button/);
  });

  it('rejects a button with no states and an initial state it does not define', () => {
    const noStates = profile({
      root: folder('root', { pages: [page('main', [{ id: 'b', key: 0, states: [] }])] }),
    });
    assert.throws(() => validateProfile(noStates), /has no states/);

    const badInitial = profile({
      root: folder('root', {
        pages: [
          page('main', [
            { id: 'b', key: 0, initialStateId: 'nope', states: [{ id: 's', visual: {} }] },
          ]),
        ],
      }),
    });
    assert.throws(() => validateProfile(badInitial), /which it does not define/);
  });

  it('rejects actions bound to an unknown event', () => {
    const bad = profile({
      root: folder('root', {
        pages: [
          page('main', [
            {
              id: 'b',
              key: 0,
              states: [{ id: 's', visual: {}, actions: { doubleClick: [] } as never }],
            },
          ]),
        ],
      }),
    });
    assert.throws(() => validateProfile(bad), /unknown event 'doubleClick'/);
  });

  it('rejects a starting point that does not exist', () => {
    assert.throws(() => validateProfile(profile({ initialFolderId: 'nope' })), /does not exist/);
    assert.throws(() => validateProfile(profile({ initialPageId: 'nope' })), /does not exist/);
  });
});
