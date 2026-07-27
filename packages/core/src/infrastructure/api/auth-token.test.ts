import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadOrCreateToken, originAllowed, tokenMatches } from './auth-token.js';

describe('API token', () => {
  let directory: string;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'easydeck-token-'));
  });

  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('creates a long random token on first use and reuses it afterwards', async () => {
    const first = await loadOrCreateToken(directory);
    const second = await loadOrCreateToken(directory);

    assert.equal(first, second);
    assert.ok(first.length >= 64, 'token should be at least 32 bytes of hex');
    assert.match(first, /^[0-9a-f]+$/);
    assert.equal((await readFile(join(directory, 'api-token'), 'utf8')).trim(), first);
  });

  it('mints a fresh token when the stored one is too short to be a secret', async () => {
    const short = await mkdtemp(join(tmpdir(), 'easydeck-token-short-'));
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(short, 'api-token'), 'hunter2\n', 'utf8'),
    );

    const token = await loadOrCreateToken(short);
    assert.notEqual(token, 'hunter2');
    await rm(short, { recursive: true, force: true });
  });

  it('accepts only the exact token', () => {
    assert.equal(tokenMatches('abc123', 'abc123'), true);
    assert.equal(tokenMatches('abc123', 'abc124'), false);
    assert.equal(tokenMatches('abc123', 'abc'), false);
    assert.equal(tokenMatches('abc123', undefined), false);
  });
});

describe('origin check', () => {
  // Browsers do not apply CORS to WebSocket handshakes, so without this any
  // web page could open a socket to the daemon — which can write profiles,
  // and a profile can launch programs.
  it('rejects a browser origin that is not the daemon itself', () => {
    assert.equal(originAllowed('https://evil.example', 8317), false);
    assert.equal(originAllowed('http://127.0.0.1:9999', 8317), false);
  });

  it('accepts the daemoner own origins', () => {
    assert.equal(originAllowed('http://127.0.0.1:8317', 8317), true);
    assert.equal(originAllowed('http://localhost:8317', 8317), true);
  });

  it('accepts a missing origin, which the token still gates', () => {
    // Non-browser clients — scripts, native apps — send no Origin at all.
    assert.equal(originAllowed(undefined, 8317), true);
  });
});
