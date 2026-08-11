import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Just enough ZIP to write one.
 *
 * The other half of `zip.ts`, and written for the same reason: the format is
 * a local header per file, the payloads, and a central directory at the end,
 * which is a page of code against a dependency that also brings encryption,
 * spanning and ZIP64 for a format frozen in 1993.
 *
 * What it makes is an ordinary archive that any tool opens — that is the whole
 * point of exporting a profile as one. A person should be able to look inside
 * before sending it to somebody, and get the pictures out again with the
 * tools they already have.
 */

export interface ZipFile {
  /** Forward slashes, no leading slash — as a ZIP stores them. */
  readonly name: string;
  readonly bytes: Uint8Array;
  /**
   * Whether to compress it.
   *
   * Off for anything already compressed: a PNG or a GIF put through deflate
   * comes out the same size having cost the time twice.
   */
  readonly compress?: boolean;
}

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;

/** Deflate where it helps, stored where it does not. */
const STORED = 0;
const DEFLATE = 8;

/**
 * Everything a reader needs to find one file, twice over.
 *
 * A ZIP says each entry's name and size in two places — once before the data
 * and once in the directory at the end — and readers disagree about which to
 * trust, so both have to say the same thing.
 */
interface Placed {
  readonly file: ZipFile;
  readonly method: number;
  readonly payload: Uint8Array;
  readonly crc: number;
  readonly offset: number;
}

export function writeZip(files: readonly ZipFile[]): Uint8Array {
  const placed: Placed[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const compress = file.compress ?? true;
    const deflated = compress ? deflateRawSync(file.bytes) : undefined;

    // Only if it actually helped: deflate can make already-compressed bytes
    // slightly larger, and an archive should never be bigger for trying.
    const useDeflate = deflated !== undefined && deflated.length < file.bytes.length;
    const payload = useDeflate ? deflated : file.bytes;

    const entry: Placed = {
      file,
      method: useDeflate ? DEFLATE : STORED,
      payload,
      crc: crc32(file.bytes),
      offset,
    };
    placed.push(entry);

    const header = localHeader(entry);
    chunks.push(header, payload);
    offset += header.length + payload.length;
  }

  const directory: Uint8Array[] = [];
  let directorySize = 0;
  for (const entry of placed) {
    const record = centralRecord(entry);
    directory.push(record);
    directorySize += record.length;
  }

  const end = endRecord(placed.length, directorySize, offset);
  return concat([...chunks, ...directory, end]);
}

function localHeader(entry: Placed): Uint8Array {
  const name = Buffer.from(entry.file.name, 'utf8');
  const header = Buffer.alloc(30 + name.length);

  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(20, 4); // version needed: 2.0, which is deflate
  header.writeUInt16LE(0x0800, 6); // names are UTF-8
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(0, 10); // time: left at zero, see the note in endRecord
  header.writeUInt16LE(0, 12); // date
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.payload.length, 18);
  header.writeUInt32LE(entry.file.bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // no extra field
  name.copy(header, 30);

  return header;
}

function centralRecord(entry: Placed): Uint8Array {
  const name = Buffer.from(entry.file.name, 'utf8');
  const record = Buffer.alloc(46 + name.length);

  record.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  record.writeUInt16LE(20, 4); // version made by
  record.writeUInt16LE(20, 6); // version needed
  record.writeUInt16LE(0x0800, 8);
  record.writeUInt16LE(entry.method, 10);
  record.writeUInt16LE(0, 12);
  record.writeUInt16LE(0, 14);
  record.writeUInt32LE(entry.crc, 16);
  record.writeUInt32LE(entry.payload.length, 20);
  record.writeUInt32LE(entry.file.bytes.length, 24);
  record.writeUInt16LE(name.length, 28);
  record.writeUInt16LE(0, 30); // extra
  record.writeUInt16LE(0, 32); // comment
  record.writeUInt16LE(0, 34); // disk number
  record.writeUInt16LE(0, 36); // internal attributes
  record.writeUInt32LE(0, 38); // external attributes
  record.writeUInt32LE(entry.offset, 42);
  name.copy(record, 46);

  return record;
}

/**
 * Timestamps are left at zero throughout.
 *
 * Deliberately: an export of an unchanged profile should be byte-for-byte the
 * same file, so that "did anything change?" can be answered by comparing two
 * exports rather than by reading them. Every tool shows 1980 for such an
 * entry, which is odd-looking and harmless.
 */
function endRecord(count: number, directorySize: number, directoryOffset: number): Uint8Array {
  const record = Buffer.alloc(22);

  record.writeUInt32LE(END_SIGNATURE, 0);
  record.writeUInt16LE(0, 4); // this disk
  record.writeUInt16LE(0, 6); // disk with the directory
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(directorySize, 12);
  record.writeUInt32LE(directoryOffset, 16);
  record.writeUInt16LE(0, 20); // no comment

  return record;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);

  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}
