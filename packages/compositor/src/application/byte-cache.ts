/**
 * An LRU cache measured in bytes rather than entries.
 *
 * Counting entries is what the old renderer cache did, and it could not work:
 * one entry there was either a four-kilobyte still or a hundred frames of an
 * animation, so any limit was either uselessly small for one or dangerous for
 * the other. Bytes are the thing actually in short supply, so bytes are what
 * is counted.
 *
 * Entries can be pinned. A region that is on the panel right now must not have
 * its frames evicted by the work of preparing some other region — that would
 * produce a stutter whose cause is invisible from the outside.
 */
export class ByteCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>();
  private readonly pinned = new Set<string>();
  private used = 0;

  constructor(private readonly limitBytes: number) {}

  get size(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.used;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    // Re-inserting moves it to the end, which is what makes this LRU: a Map
    // iterates in insertion order, so the oldest is always first.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    const existing = this.entries.get(key);
    if (existing) this.used -= existing.bytes;

    this.entries.delete(key);
    this.entries.set(key, { value, bytes });
    this.used += bytes;

    // The entry just written is exempt from its own eviction pass. Without
    // this, storing into a cache whose older entries are all pinned drops the
    // newcomer immediately — the cache would quietly stop caching exactly when
    // the panel is busiest.
    this.evict(key);
  }

  /** Protects a key from eviction until it is released. */
  pin(key: string): void {
    this.pinned.add(key);
  }

  unpin(key: string): void {
    this.pinned.delete(key);
    this.evict();
  }

  /** Releases every pin except the ones named. */
  keepPinned(keys: Iterable<string>): void {
    const keep = new Set(keys);
    for (const key of [...this.pinned]) {
      if (!keep.has(key)) this.pinned.delete(key);
    }
    this.evict();
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;

    this.used -= entry.bytes;
    this.entries.delete(key);
    this.pinned.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.pinned.clear();
    this.used = 0;
  }

  /**
   * Drops oldest first, skipping what is pinned.
   *
   * Pinned entries still count against the limit. Letting them push it aside
   * would turn "the panel is showing a lot at once" into unbounded memory
   * growth, which is the failure this class exists to prevent; going over the
   * limit while everything in the cache is in use is the lesser evil, and it
   * resolves itself as soon as a region is released.
   */
  private evict(protectedKey?: string): void {
    if (this.used <= this.limitBytes) return;

    for (const [key, entry] of this.entries) {
      if (this.used <= this.limitBytes) return;
      if (key === protectedKey || this.pinned.has(key)) continue;

      this.entries.delete(key);
      this.used -= entry.bytes;
    }
  }
}
