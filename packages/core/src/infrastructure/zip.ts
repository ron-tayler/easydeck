import { inflateRawSync } from 'node:zlib';

/**
 * Just enough ZIP to read a file someone dropped in a folder.
 *
 * Written rather than depended on. What an icon pack needs is the central
 * directory and two compression methods — stored and deflate — which zlib
 * already provides; a library would bring encryption, spanning, ZIP64 and a
 * supply chain along with it, for a format that has not changed since 1993.
 *
 * Deliberately absent: encrypted entries, ZIP64, and anything written into a
 * path. Nothing here touches the filesystem — entries are read into memory by
 * name — so a `../..` in an archive is a name that matches nothing, not a
 * file escaping the folder it was meant to land in.
 */

export interface ZipEntry {
  readonly name: string;
  readonly compressedSize: number;
  readonly size: number;
  /** 0 stored, 8 deflate. Anything else is skipped when read. */
  readonly method: number;
  readonly offset: number;
}

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** A ZIP comment can be this long, and the end record hides behind it. */
const MAX_COMMENT = 0xffff;

export class ZipArchive {
  private readonly entries = new Map<string, ZipEntry>();

  constructor(private readonly bytes: Buffer) {
    for (const entry of readCentralDirectory(bytes)) this.entries.set(entry.name, entry);
  }

  /** Entry names, in the order the archive lists them. */
  names(): string[] {
    return [...this.entries.keys()];
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** The contents of one entry, or undefined if it is absent or unreadable. */
  read(name: string): Buffer | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;

    // The central directory says where the local header is; the local header
    // says how much padding sits between it and the data. Both name and extra
    // lengths can differ from the central copy, which is why they are read
    // here rather than assumed.
    const header = entry.offset;
    if (header + 30 > this.bytes.length) return undefined;
    if (this.bytes.readUInt32LE(header) !== LOCAL_SIGNATURE) return undefined;

    const nameLength = this.bytes.readUInt16LE(header + 26);
    const extraLength = this.bytes.readUInt16LE(header + 28);
    const start = header + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > this.bytes.length) return undefined;

    const raw = this.bytes.subarray(start, end);
    if (entry.method === 0) return Buffer.from(raw);
    if (entry.method !== 8) return undefined;

    try {
      return inflateRawSync(raw);
    } catch {
      return undefined;
    }
  }

  /** The entry's contents as text, or undefined. */
  readText(name: string): string | undefined {
    return this.read(name)?.toString('utf8');
  }
}

function readCentralDirectory(bytes: Buffer): ZipEntry[] {
  const end = findEndRecord(bytes);
  if (end === undefined) return [];

  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < count; index++) {
    if (cursor + 46 > bytes.length) break;
    if (bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) break;

    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);

    entries.push({
      name: bytes.toString('utf8', cursor + 46, cursor + 46 + nameLength),
      method: bytes.readUInt16LE(cursor + 10),
      compressedSize: bytes.readUInt32LE(cursor + 20),
      size: bytes.readUInt32LE(cursor + 24),
      offset: bytes.readUInt32LE(cursor + 42),
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Searched for backwards, because the record it ends with is variable length. */
function findEndRecord(bytes: Buffer): number | undefined {
  const earliest = Math.max(0, bytes.length - MAX_COMMENT - 22);

  for (let at = bytes.length - 22; at >= earliest; at--) {
    if (bytes.readUInt32LE(at) === END_SIGNATURE) return at;
  }

  return undefined;
}
