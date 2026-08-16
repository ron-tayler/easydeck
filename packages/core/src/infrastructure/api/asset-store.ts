import { createHash } from 'node:crypto';

/**
 * Pictures, handed out by link instead of by value.
 *
 * A profile stores its pictures as data URLs, which suits the file on disk but
 * is ruinous over a socket: a key's description carries the whole picture, and
 * a picture stretched across a region is repeated once per key it covers. One
 * seven-megabyte animation across fifteen keys is a hundred megabytes of JSON
 * for a page that shows a single GIF — the network deck spent all of it before
 * drawing anything.
 *
 * Registering the bytes here and sending `/asset/<id>` instead costs one
 * download for the whole region, cached by the browser like any other image,
 * and the id is the digest of the content, so a picture that has not changed is
 * never fetched twice.
 */

export interface StoredAsset {
  readonly bytes: Buffer;
  readonly contentType: string;
}

const DATA_URL = /^data:([^;,]+)(;base64)?,(.*)$/s;

/**
 * How many pictures are remembered by the text they arrived as.
 *
 * A page holds fifteen keys and a parametric icon is a new picture at every
 * position of its needle, so this is generous for the first and deliberately
 * finite for the second.
 */
const REMEMBERED = 256;

export class AssetStore {
  private readonly assets = new Map<string, StoredAsset>();

  /**
   * Which link each picture was given, by the text it came in as.
   *
   * The digest is over the bytes, so working out a link means decoding the
   * base64 and hashing the result — proportional to the picture, and the page
   * view asks for every icon on it every time a variable moves. Nine traced
   * drawings came to a few milliseconds a pass spent re-deciding something
   * that cannot change.
   */
  private readonly links = new Map<string, string>();

  /**
   * Files the picture and returns the path to fetch it from, or the source
   * unchanged when it is not something we hold — a plain URL is already a
   * link, and a path belongs to whoever can read the disk.
   */
  link(source: string): string {
    if (!source.startsWith('data:')) return source;

    const known = this.links.get(source);
    if (known !== undefined) return known;

    const match = DATA_URL.exec(source);
    if (!match) return source;

    const [, contentType, base64, payload] = match;
    const bytes = Buffer.from(
      base64 ? payload! : decodeURIComponent(payload!),
      base64 ? 'base64' : 'utf8',
    );

    // Content-addressed: the same picture always gets the same link, which is
    // what lets the browser keep it across pages and across reconnects.
    const id = createHash('sha1').update(bytes).digest('base64url').slice(0, 16);
    if (!this.assets.has(id)) this.assets.set(id, { bytes, contentType: contentType! });

    const path = `/asset/${id}`;
    this.links.set(source, path);
    // Oldest first. Forgetting one costs a hash the next time it is asked for
    // and nothing else: the bytes stay filed under the id they already have.
    for (const key of this.links.keys()) {
      if (this.links.size <= REMEMBERED) break;
      this.links.delete(key);
    }

    return path;
  }

  get(id: string): StoredAsset | undefined {
    return this.assets.get(id);
  }
}
