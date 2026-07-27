import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertOpenable, parseScheme } from './system-actions.js';

describe('open target validation', () => {
  // Regression: new URL('C:\\Users\\me') reports the scheme 'c:', so a naive
  // scheme whitelist rejects every absolute Windows path.
  it('treats Windows drive and UNC paths as paths, not URLs', () => {
    assert.equal(parseScheme('C:\\Users\\me\\AppData\\Roaming\\EasyDeck'), undefined);
    assert.equal(parseScheme('c:/Users/me'), undefined);
    assert.equal(parseScheme('\\\\server\\share\\folder'), undefined);

    assert.doesNotThrow(() => assertOpenable('C:\\Users\\me\\AppData\\Roaming\\EasyDeck'));
    assert.doesNotThrow(() => assertOpenable('\\\\server\\share'));
  });

  it('treats POSIX and relative paths as paths', () => {
    assert.equal(parseScheme('/home/me/.config/easydeck'), undefined);
    assert.equal(parseScheme('./profiles'), undefined);
    assert.doesNotThrow(() => assertOpenable('/home/me/.config/easydeck'));
  });

  it('still recognises real URL schemes', () => {
    assert.equal(parseScheme('https://github.com'), 'https:');
    assert.equal(parseScheme('mailto:someone@example.com'), 'mailto:');
    assert.doesNotThrow(() => assertOpenable('https://github.com'));
  });

  it('refuses schemes that are not meant to be opened', () => {
    assert.throws(() => assertOpenable('javascript:alert(1)'), /Refusing to open/);
    assert.throws(() => assertOpenable('data:text/html,<script>'), /Refusing to open/);
  });

  it('refuses an empty target instead of opening something arbitrary', () => {
    assert.throws(() => assertOpenable('   '), /is empty/);
  });
});
