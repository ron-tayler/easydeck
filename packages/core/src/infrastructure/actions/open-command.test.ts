import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertOpenable, openCommand } from './system-actions.js';

/** The Epic Games deep link, which is where the ampersand rule came from. */
const EPIC =
  'com.epicgames.launcher://apps/14d53b5d3fcb4526a69d59f35c9dd28f%3A6838c695288a4fcea4486285edebcfdf%3Abcd55b0d87c245dd867f5b1bd496f1df?action=launch&silent=true';

describe('openCommand', () => {
  if (process.platform === 'win32') {
    // Regression: `cmd /c start` receives a bare filesystem path in a form the
    // shell handler reports as an inaccessible *file*. Paths must go to
    // explorer.exe, which opens both files and folders reliably.
    it('sends filesystem paths to explorer, not to cmd start', () => {
      const [command, args] = openCommand('C:\\Users\\me\\AppData\\Roaming\\EasyDeck', false);
      assert.equal(command, 'explorer.exe');
      assert.deepEqual(args, ['C:\\Users\\me\\AppData\\Roaming\\EasyDeck']);
    });

    /*
     * Two regressions, one test.
     *
     * Handed to `cmd /c start`, this link arrives as `…?action=launch` and
     * `silent=true` is run as a separate command — measured, not feared. And
     * handed to `explorer.exe`, which was the fix for that, a link opens
     * nothing at all: explorer is for files and folders, and a plugin's
     * sign-in stopped reaching a browser because of it.
     */
    it('opens a link with the handler for links, ampersand and all', () => {
      const [command, args] = openCommand(EPIC, true);

      assert.equal(command, 'rundll32.exe');
      assert.deepEqual(args, ['url.dll,FileProtocolHandler', EPIC]);
      assert.ok(args[1]!.includes('&silent=true'));
    });

    it('opens an ordinary web address the same way', () => {
      // Which is what `openExternal` is: a plugin sending somebody to a page
      // to sign in.
      const [command, args] = openCommand('https://passport.yandex.ru/am/push/qrsecure?track_id=1&magic=2', true);

      assert.equal(command, 'rundll32.exe');
      assert.match(args[1]!, /&magic=2$/);
    });

    it('passes a shortcut its arguments', () => {
      const [command, args] = openCommand('C:\\Menu\\Game.lnk', false, ['-windowed']);
      assert.equal(command, 'explorer.exe');
      assert.deepEqual(args, ['C:\\Menu\\Game.lnk', '-windowed']);
    });
  } else {
    it('uses the platform opener for both paths and URLs', () => {
      const expected = process.platform === 'darwin' ? 'open' : 'xdg-open';

      assert.deepEqual(openCommand('/home/me/.config', false), [expected, ['/home/me/.config']]);
      assert.deepEqual(openCommand('https://github.com', true), [expected, ['https://github.com']]);
    });
  }
});

describe('what may be opened', () => {
  it('accepts a launcher deep link, whatever the launcher is called', () => {
    // The old whitelist — http, https, mailto, file — turned every one of
    // these into "Refusing to open 'steam:' targets".
    assertOpenable(EPIC);
    assertOpenable('steam://rungameid/1905180');
    assertOpenable('ms-settings:display');
    assertOpenable('obsidian://open?vault=notes');
  });

  it('still accepts the ordinary things', () => {
    assertOpenable('https://github.com');
    assertOpenable('C:\\Users\\me\\notes.txt');
    assertOpenable('/home/me/notes.txt');
    assertOpenable('\\\\server\\share\\file.txt');
  });

  it('refuses an empty target', () => {
    assert.throws(() => assertOpenable('   '), /empty/);
  });

  it('still refuses the schemes that only ever mean "run this code"', () => {
    // The whitelist became a blacklist, not nothing: no launcher speaks
    // these, and a key that wants to run code has an action for that.
    assert.throws(() => assertOpenable('javascript:alert(1)'), /Refusing to open/);
    assert.throws(() => assertOpenable('data:text/html,<script>'), /Refusing to open/);
  });
});
