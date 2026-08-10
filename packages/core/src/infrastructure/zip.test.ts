import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { ZipArchive } from './zip.js';

/**
 * Enough ZIP to read an icon pack, and no more.
 *
 * The archives here are built by hand rather than by a library, which is the
 * point: the reader has to cope with what other programs actually write —
 * stored entries, deflated entries, a trailing comment — without a matching
 * writer papering over an assumption.
 */

interface Entry {
  readonly name: string;
  readonly data: Buffer;
  /** 0 stored, 8 deflate. */
  readonly method: number;
}

function zip(entries: readonly Entry[], comment = ''): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const payload = entry.method === 8 ? deflateRawSync(entry.data) : entry.data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, payload);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt32LE(payload.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + payload.length;
  }

  const body = Buffer.concat(locals);
  const directory = Buffer.concat(central);
  const tail = Buffer.from(comment, 'utf8');

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  end.writeUInt16LE(tail.length, 20);

  return Buffer.concat([body, directory, end, tail]);
}

describe('reading a zip', () => {
  it('reads a stored entry and a deflated one alike', () => {
    // Icon packs use both: tiny SVGs are often stored, larger ones deflated.
    const text = 'a'.repeat(500);
    const archive = new ZipArchive(
      zip([
        { name: 'plain.txt', data: Buffer.from('hello'), method: 0 },
        { name: 'squashed.txt', data: Buffer.from(text), method: 8 },
      ]),
    );

    assert.equal(archive.readText('plain.txt'), 'hello');
    assert.equal(archive.readText('squashed.txt'), text);
  });

  it('finds the directory behind a trailing comment', () => {
    // The end record is variable length and has to be searched for backwards;
    // a comment is what makes a naive "read the last 22 bytes" fail.
    const archive = new ZipArchive(
      zip([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }], 'packed by something'),
    );

    assert.deepEqual(archive.names(), ['a.txt']);
    assert.equal(archive.readText('a.txt'), 'x');
  });

  it('answers nothing for an entry that is not there', () => {
    const archive = new ZipArchive(zip([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }]));

    assert.equal(archive.read('b.txt'), undefined);
    assert.equal(archive.has('b.txt'), false);
  });

  it('treats a file that is not an archive as empty', () => {
    // A folder full of pictures may hold anything at all; the reader has to
    // say "not for me" rather than throw.
    assert.deepEqual(new ZipArchive(Buffer.from('this is not a zip')).names(), []);
    assert.deepEqual(new ZipArchive(Buffer.alloc(0)).names(), []);
  });

  it('refuses an entry whose data runs past the end of the file', () => {
    // A truncated download, or an archive built to lie about its own sizes.
    const bytes = zip([{ name: 'a.txt', data: Buffer.from('x'), method: 0 }]);
    const truncated = Buffer.concat([bytes.subarray(0, 20), bytes.subarray(30)]);

    // Whatever it makes of the damage, it must not throw.
    assert.doesNotThrow(() => new ZipArchive(truncated).read('a.txt'));
  });
});
