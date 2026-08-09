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

export class AssetStore {
  private readonly assets = new Map<string, StoredAsset>();

  /**
   * Files the picture and returns the path to fetch it from, or the source
   * unchanged when it is not something we hold — a plain URL is already a
   * link, and a path belongs to whoever can read the disk.
   */
  link(source: string): string {
    if (!source.startsWith('data:')) return source;

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

    return `/asset/${id}`;
  }

  get(id: string): StoredAsset | undefined {
    return this.assets.get(id);
  }
}
