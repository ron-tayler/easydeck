import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { LogFile, describe as describeCause } from './log-file.js';

const roots: string[] = [];

after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'easydeck-log-'));
  roots.push(root);
  return root;
}

const files = async (directory: string): Promise<string[]> => (await readdir(directory)).sort();

describe('the log file', () => {
  it('writes a line anybody can read, with the time on it', async () => {
    const directory = await scratch();
    const log = new LogFile({ directory });
    log.start();

    log.info('Plugins loaded: ed.obs');
    log.warn('Discord is not running');

    const written = await readFile(join(directory, 'easydeck.log'), 'utf8');
    const lines = written.trimEnd().split('\n');

    assert.match(lines[0]!, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} INFO {2}Plugins loaded: ed\.obs$/);
    assert.match(lines[1]!, /WARN {2}Discord is not running$/);
  });

  it('says why a key failed, not merely that one did', async () => {
    const directory = await scratch();
    const log = new LogFile({ directory });
    log.start();

    /*
     * The shape a failed action actually arrives in: an outer error naming
     * the action and the button, carrying the real reason underneath. A log
     * that printed only the outer message would say that something failed and
     * never what — which is the whole reason this exists.
     */
    const cause = new Error('Discord is not connected');
    const failure = new Error("Action 'ed.discord.mute' on button 'b3' failed", { cause });

    log.error('Key failed', failure);

    const written = await readFile(join(directory, 'easydeck.log'), 'utf8');
    assert.match(written, /ERROR Key failed: Action 'ed\.discord\.mute' on button 'b3' failed/);
    assert.match(written, /<- Discord is not connected/);
  });

  it('keeps a line on one line, whatever it was handed', async () => {
    const directory = await scratch();
    const log = new LogFile({ directory });
    log.start();

    // A stack, or a message somebody wrote with a newline in it. One line per
    // entry is what makes a log greppable.
    log.warn('first\nsecond\r\nthird');

    const written = await readFile(join(directory, 'easydeck.log'), 'utf8');
    assert.equal(written.trimEnd().split('\n').length, 1);
    assert.match(written, /first ⏎ second ⏎ third/);
  });

  it('pushes the last run down a number and starts a new file', async () => {
    const directory = await scratch();

    const first = new LogFile({ directory });
    first.start();
    first.info('the first run');

    const second = new LogFile({ directory });
    second.start();
    second.info('the second run');

    // A log is one run, so "before and after the restart" is two files.
    assert.match(await readFile(join(directory, 'easydeck.log'), 'utf8'), /the second run/);
    assert.match(await readFile(join(directory, 'easydeck.1.log'), 'utf8'), /the first run/);
  });

  it('never keeps more than it was told to', async () => {
    const directory = await scratch();

    // Seven runs, five kept: the deck is not an audit trail, and a folder
    // that grows for ever is one somebody finds at four gigabytes.
    for (let run = 1; run <= 7; run += 1) {
      const log = new LogFile({ directory, keep: 5 });
      log.start();
      log.info(`run ${run}`);
    }

    assert.deepEqual(await files(directory), [
      'easydeck.1.log',
      'easydeck.2.log',
      'easydeck.3.log',
      'easydeck.4.log',
      'easydeck.log',
    ]);

    assert.match(await readFile(join(directory, 'easydeck.log'), 'utf8'), /run 7/);
    // Oldest kept is four restarts back; the first three are gone.
    assert.match(await readFile(join(directory, 'easydeck.4.log'), 'utf8'), /run 3/);
  });

  it('pushes itself down mid-run when it grows past the limit', async () => {
    const directory = await scratch();
    // Small enough that a few lines cross it; the rule is the same at a
    // megabyte, and one plugin in a loop should cost a few files rather than
    // the disk.
    const log = new LogFile({ directory, maxBytes: 200, keep: 3 });
    log.start();

    for (let line = 0; line < 20; line += 1) log.info(`line number ${line}`);

    const kept = await files(directory);
    assert.deepEqual(kept, ['easydeck.1.log', 'easydeck.2.log', 'easydeck.log']);

    // The limit is a limit: rotated before the line that would cross it, not
    // after.
    for (const name of kept) {
      const written = await readFile(join(directory, name), 'utf8');
      assert.ok(written.length <= 200, `${name} is ${written.length} bytes`);
    }

    // And the newest lines are in the current file, not the oldest.
    assert.match(await readFile(join(directory, 'easydeck.log'), 'utf8'), /line number 19/);
  });

  it('does nothing until it is started, so building one is harmless', async () => {
    const directory = await scratch();

    // A test or a tool that constructs a logger must not rotate somebody's
    // logs by existing.
    await writeFile(join(directory, 'easydeck.log'), 'from an earlier run', 'utf8');
    const log = new LogFile({ directory });
    log.info('this goes nowhere');

    assert.deepEqual(await files(directory), ['easydeck.log']);
    assert.equal(await readFile(join(directory, 'easydeck.log'), 'utf8'), 'from an earlier run');
  });

  it('gives up quietly when it cannot write at all', async () => {
    // A folder that is a file: whatever the platform's reason, the program
    // must not fail because its log could not be opened.
    const root = await scratch();
    const impossible = join(root, 'not-a-folder');
    await writeFile(impossible, 'x', 'utf8');

    const log = new LogFile({ directory: join(impossible, 'logs') });
    assert.doesNotThrow(() => log.start());
    assert.doesNotThrow(() => log.error('and this is simply lost'));
  });
});

describe('unwrapping a reason', () => {
  it('follows the chain as far as it goes', () => {
    const bottom = new Error('the pipe is closed');
    const middle = new Error('Discord is not connected', { cause: bottom });
    const top = new Error("Action 'x' failed", { cause: middle });

    assert.equal(describeCause(top), "Action 'x' failed <- Discord is not connected <- the pipe is closed");
  });

  it('says something useful about whatever it was given', () => {
    assert.equal(describeCause('just a string'), 'just a string');
    assert.equal(describeCause(new Error('plain')), 'plain');
    assert.equal(describeCause(undefined), 'undefined');
  });
});
