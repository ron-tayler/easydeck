import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { manifestChannel, releasePageUrl, updateAbility } from './channel.js';

describe('which manifest a channel reads', () => {
  it('names the two the release workflow writes', () => {
    assert.equal(manifestChannel('stable'), 'latest');
    assert.equal(manifestChannel('prerelease'), 'beta');
  });
});

describe('what an installation may do about a new version', () => {
  const installed = { platform: 'win32' as NodeJS.Platform, packaged: true, appImage: false };

  it('replaces itself on Windows', () => {
    assert.deepEqual(updateAbility(installed), { self: true });
  });

  it('replaces itself when it is the AppImage it would overwrite', () => {
    assert.deepEqual(updateAbility({ ...installed, platform: 'linux', appImage: true }), { self: true });
  });

  it('leaves a deb alone, because the package manager owns those files', () => {
    assert.deepEqual(updateAbility({ ...installed, platform: 'linux', appImage: false }), {
      self: false,
      reason: 'linux-package',
    });
  });

  it('will not try on macOS while the builds carry no signature', () => {
    // Squirrel verifies what it is about to swap in and refuses an unsigned
    // build, so downloading one would only spend bandwidth on a refusal.
    assert.deepEqual(updateAbility({ ...installed, platform: 'darwin' }), {
      self: false,
      reason: 'unsigned-macos',
    });
  });

  it('does nothing at all when running from source', () => {
    // No installation to replace, and asking anyway produces an error about a
    // missing app-update.yml on a timer for the rest of the session.
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      assert.deepEqual(updateAbility({ platform, packaged: false, appImage: false }), {
        self: false,
        reason: 'development',
      });
    }
  });
});

describe('where somebody is sent to fetch a build by hand', () => {
  it('lands on the release itself rather than the list of them', () => {
    assert.equal(
      releasePageUrl('0.3.0-rc.1'),
      'https://github.com/ron-tayler/easydeck/releases/tag/v0.3.0-rc.1',
    );
  });
});
