import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { literal, script } from './win32-speech.js';

/**
 * The script, not the speaking.
 *
 * What is worth being wrong about here is what reaches a shell. The text on a
 * key is whatever somebody typed — and it is a template, so it may also be
 * whatever a plugin published into a variable, which is to say whatever OBS or
 * a chat message put there.
 */

describe('quoting for PowerShell', () => {
  it('doubles the one character that ends a literal', () => {
    assert.equal(literal("it's"), "'it''s'");
    assert.equal(literal('plain'), "'plain'");
  });

  it('leaves everything else exactly as it was', () => {
    // A single-quoted PowerShell string expands nothing: no `$`, no backtick,
    // no subexpression. That is the whole reason this quoting is one rule.
    assert.equal(literal('$(Remove-Item C:\\)'), "'$(Remove-Item C:\\)'");
    assert.equal(literal('`n'), "'`n'");
    assert.equal(literal('100% & "quoted"'), "'100% & \"quoted\"'");
  });
});

describe('the script that says something', () => {
  it('never pastes the text in raw', () => {
    const made = script({ text: "'; Remove-Item -Recurse C:\\; '" });

    // The injected quote is doubled, so the whole thing stays one argument.
    assert.match(made, /\$voice\.Speak\('''; Remove-Item -Recurse C:\\; ''''?\)/);
    assert.doesNotMatch(made, /^Remove-Item/m);
  });

  it('quotes the voice as carefully as the text', () => {
    // Descriptions come from Windows, but they reach the same shell.
    const made = script({ text: 'hello', voice: "Bob's Voice" });
    assert.match(made, /\$wanted = 'Bob''s Voice'/);
  });

  it('asks for nothing it was not told', () => {
    // A rate of zero is a choice and a missing rate is not, so an untouched
    // field must not write itself into the script as a number.
    const bare = script({ text: 'hello' });

    assert.doesNotMatch(bare, /\$voice\.Rate/);
    assert.doesNotMatch(bare, /\$voice\.Volume/);
    assert.doesNotMatch(bare, /\$voice\.Voice/);
  });

  it('keeps the numbers inside the range SAPI takes', () => {
    const loud = script({ text: 'hello', rate: 99, volume: 500 });
    assert.match(loud, /\$voice\.Rate = 10/);
    assert.match(loud, /\$voice\.Volume = 100/);

    const slow = script({ text: 'hello', rate: -99, volume: -20 });
    assert.match(slow, /\$voice\.Rate = -10/);
    assert.match(slow, /\$voice\.Volume = 0/);
  });

  it('falls back rather than falling silent when a voice has gone', () => {
    /*
     * A key naming a voice somebody has since uninstalled should still be
     * heard. The script looks the description up and only assigns it if it
     * found one, so an absent voice leaves whatever Windows prefers.
     */
    const made = script({ text: 'hello', voice: 'Microsoft Irina Desktop - Russian' });
    assert.match(made, /if \(\$found\) \{ \$voice\.Voice = \$found \}/);
  });

  it('speaks synchronously, which is what makes stopping possible', () => {
    // The process living is what "still speaking" means, so killing it is an
    // interruption and its exit is the cue for the next phrase.
    const made = script({ text: 'hello' });
    assert.doesNotMatch(made, /Speak\([^)]*,\s*1\)/);
  });
});
