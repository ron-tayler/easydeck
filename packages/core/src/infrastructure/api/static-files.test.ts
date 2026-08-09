import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { serveDirectory } from './static-files.js';

let root: string;

/** Captures what the handler wrote, without a socket in sight. */
function fakeResponse() {
  const chunks: Buffer[] = [];
  let status = 0;
  let headers: Record<string, string> = {};

  const response = {
    headersSent: false,
    writeHead(code: number, value?: Record<string, string>) {
      status = code;
      headers = value ?? {};
      response.headersSent = true;
      return response;
    },
    end(chunk?: unknown) {
      if (chunk) chunks.push(Buffer.from(chunk as Buffer));
      return response;
    },
    write(chunk: unknown) {
      chunks.push(Buffer.from(chunk as Buffer));
      return true;
    },
    on() {
      return response;
    },
    once() {
      return response;
    },
    emit() {
      return false;
    },
  };

  return {
    response: response as unknown as ServerResponse,
    get status() {
      return status;
    },
    get headers() {
      return headers;
    },
    get body() {
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

const request = (url: string, method = 'GET'): IncomingMessage =>
  ({ url, method }) as IncomingMessage;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'easydeck-static-'));
  await writeFile(join(root, 'index.html'), '<!doctype html>page', 'utf8');
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)', 'utf8');
  await writeFile(join(join(root, '..'), 'secret.txt'), 'not yours', 'utf8');
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('serving the configurator', () => {
  it('serves the page at the root', async () => {
    const out = fakeResponse();
    const served = await serveDirectory(root).serve(request('/'), out.response);

    assert.equal(served, true);
    assert.equal(out.status, 200);
    assert.match(out.headers['content-type'] ?? '', /text\/html/);
  });

  it('serves an asset with its own content type', async () => {
    const out = fakeResponse();
    await serveDirectory(root).serve(request('/assets/app.js'), out.response);

    assert.match(out.headers['content-type'] ?? '', /javascript/);
  });

  it('falls back to the page for an unknown path', async () => {
    // The configurator is one document; reloading on any of its routes has to
    // land on it rather than on a 404.
    const out = fakeResponse();
    const served = await serveDirectory(root).serve(request('/settings/deck'), out.response);

    assert.equal(served, true);
    assert.equal(out.status, 200);
  });

  it('refuses to walk out of the directory it serves', async () => {
    // The daemon runs on someone's machine with their files on it. A path that
    // climbs out must land on the page, not on the disk.
    for (const url of ['/../secret.txt', '/..%2Fsecret.txt', '/assets/../../secret.txt']) {
      const out = fakeResponse();
      await serveDirectory(root).serve(request(url), out.response);

      assert.ok(!out.body.includes('not yours'), `${url} escaped the root`);
    }
  });

  it('ignores a query string when finding the file', async () => {
    // The page is opened with the token in the query.
    const out = fakeResponse();
    await serveDirectory(root).serve(request('/assets/app.js?token=abc'), out.response);

    assert.match(out.headers['content-type'] ?? '', /javascript/);
  });

  it('answers HEAD without a body', async () => {
    const out = fakeResponse();
    const served = await serveDirectory(root).serve(request('/', 'HEAD'), out.response);

    assert.equal(served, true);
    assert.equal(out.body, '');
  });

  it('leaves anything that is not a plain read alone', async () => {
    const out = fakeResponse();
    const served = await serveDirectory(root).serve(request('/', 'POST'), out.response);

    assert.equal(served, false);
  });

  it('says so when there is nothing to serve', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'easydeck-empty-'));
    const out = fakeResponse();

    const served = await serveDirectory(empty).serve(request('/'), out.response);

    assert.equal(served, false, 'an unbuilt interface must not pretend to be there');
    await rm(empty, { recursive: true, force: true });
  });
});
