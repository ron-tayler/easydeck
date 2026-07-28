import type { AnimatedFrame, KeyRendererPort } from './ports/renderer-port.js';
import type { ButtonVisual } from '../domain/visual.js';

/**
 * Remembers what each visual rendered to, so identical work is done once.
 *
 * Rendering a key is far from free: a still is rasterized and JPEG-encoded at
 * a quality that has to be searched for, and an animated one decodes an entire
 * GIF and encodes every frame. Without this, returning to a page re-does all
 * of it, and stretching a picture over six keys pays for the same GIF six
 * times over.
 *
 * The cache key is the serialized visual — the same string the controller
 * already uses to decide whether a key needs rewriting, so the two can never
 * disagree about what "unchanged" means.
 *
 * Promises are cached rather than results: two keys of one merged region ask
 * for their frames at almost the same moment, and caching the value would let
 * both start the work before either finished.
 */
export class CachingKeyRenderer implements KeyRendererPort {
  private readonly stills = new Map<string, Promise<Uint8Array>>();
  /** `null` records "asked, and it is not an animation" — worth remembering,
      since answering that can mean reading a file. */
  private readonly animations = new Map<string, Promise<readonly AnimatedFrame[] | null>>();

  constructor(
    private readonly inner: KeyRendererPort,
    /**
     * Entries kept, per cache. Generous for stills, which are a few kilobytes,
     * and deliberately small for animations, where one entry can be a hundred
     * frames.
     */
    private readonly stillLimit = 256,
    private readonly animationLimit = 24,
  ) {}

  async render(visual: ButtonVisual): Promise<Uint8Array> {
    const key = JSON.stringify(visual);
    const hit = this.stills.get(key);
    if (hit) {
      this.touch(this.stills, key, hit);
      return hit;
    }

    const pending = this.inner.render(visual);
    this.store(this.stills, key, pending, this.stillLimit);

    try {
      return await pending;
    } catch (error) {
      // A failure must not be remembered: the next attempt may well succeed,
      // and a key stuck blank until restart is a poor way to report a hiccup.
      this.stills.delete(key);
      throw error;
    }
  }

  async renderFrames(visual: ButtonVisual): Promise<readonly AnimatedFrame[] | undefined> {
    if (!this.inner.renderFrames) return undefined;

    const key = JSON.stringify(visual);
    const hit = this.animations.get(key);
    if (hit) {
      this.touch(this.animations, key, hit);
      return (await hit) ?? undefined;
    }

    const pending = this.inner.renderFrames(visual).then((frames) => frames ?? null);
    this.store(this.animations, key, pending, this.animationLimit);

    try {
      return (await pending) ?? undefined;
    } catch (error) {
      this.animations.delete(key);
      throw error;
    }
  }

  /** Forgets everything. For a host reloading plugins or changing device. */
  clear(): void {
    this.stills.clear();
    this.animations.clear();
  }

  /** Re-inserting moves the entry to the end, which is what makes this LRU:
      a Map iterates in insertion order, so the oldest is always first. */
  private touch<T>(cache: Map<string, T>, key: string, value: T): void {
    cache.delete(key);
    cache.set(key, value);
  }

  private store<T>(cache: Map<string, T>, key: string, value: T, limit: number): void {
    cache.set(key, value);
    while (cache.size > limit) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
}
