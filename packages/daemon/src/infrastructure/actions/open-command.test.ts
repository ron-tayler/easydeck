import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { openCommand } from './system-actions.js';

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

    it('sends URLs to cmd start, with the empty title argument', () => {
      const [command, args] = openCommand('https://github.com', true);
      assert.equal(command, 'cmd');
      // The empty string is start's window title; without it a quoted URL
      // would be taken as the title instead of the thing to open.
      assert.deepEqual(args, ['/c', 'start', '', 'https://github.com']);
    });
  } else {
    it('uses the platform opener for both paths and URLs', () => {
      const expected = process.platform === 'darwin' ? 'open' : 'xdg-open';

      assert.deepEqual(openCommand('/home/me/.config', false), [expected, ['/home/me/.config']]);
      assert.deepEqual(openCommand('https://github.com', true), [expected, ['https://github.com']]);
    });
  }
});
