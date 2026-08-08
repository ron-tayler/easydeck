import { createHash } from 'node:crypto';

/**
 * Short, stable names for pictures.
 *
 * A picture arrives as a path or as a data URL, and a data URL for an animated
 * icon is megabytes. Everything downstream — cache keys, scene signatures,
 * change detection — needs to *identify* it, not carry it, so it is named once
 * here and referred to by that name from then on.
 *
 * Hashing megabytes is not free, which is why the answers are kept. The cache
 * is keyed on the source string, and profiles hand back the very same string
 * object on every pass, so a repeat lookup compares a pointer rather than a
 * megabyte.
 */
export class AssetIds {
  private readonly ids = new Map<string, string>();

  id(source: string): string {
    const known = this.ids.get(source);
    if (known !== undefined) return known;

    // Eighty bits of SHA-1, which is a name rather than a signature: the worry
    // here is accidental collision between a user's pictures, not an attacker.
    const id = createHash('sha1').update(source).digest('base64url').slice(0, 14);
    this.ids.set(source, id);
    return id;
  }

  /** Forgets every name. For a profile that has been replaced wholesale. */
  clear(): void {
    this.ids.clear();
  }
}
