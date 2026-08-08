import { EventEmitter } from 'node:events';

import { digest } from '../domain/digest.js';
import { cornersOf, labelAt, validateScene } from '../domain/scene.js';
import type { Scene } from '../domain/scene.js';
import { regionGeometry } from '../domain/panel-format.js';
import type { PanelFormat } from '../domain/panel-format.js';
import { ByteCache } from './byte-cache.js';
import { PanelState } from './panel-state.js';
import { frameAt, nextChangeMs, prepareAnimation } from './prepared-animation.js';
import type { PreparedAnimation } from './prepared-animation.js';
import { planScene } from './scene-plan.js';
import type { PlannedRegion } from './scene-plan.js';
import { systemClock } from './ports/clock-port.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';
import type { ComposerPort, FrameSource, TileLabel } from './ports/composer-port.js';
import type { EncoderPort } from './ports/encoder-port.js';
import type { PanelPort } from './ports/panel-port.js';
import { WriteBudget } from './write-budget.js';

export interface PanelCompositorOptions {
  readonly clock?: ClockPort;
  /** Images a second the panel can swallow; refined from measurement. */
  readonly writesPerSecond?: number;
  readonly animationCacheBytes?: number;
}

export interface PanelCompositorEvents {
  /** Something failed in a way that should not take the panel down. */
  error: [error: Error];
  /** Emitted after every pass that wrote something, with the keys written. */
  painted: [keys: number[]];
}

/** Floor on how often the animation loop may wake, whatever the bus allows. */
const MIN_TICK_MS = 15;
const DEFAULT_ANIMATION_CACHE_BYTES = 64 * 1024 * 1024;

/** A region on the panel, with its frames and where it is in them. */
interface Playing {
  readonly animation: PreparedAnimation;
  readonly startedAt: number;
  shown: number;
}

/**
 * The panel, simulated in memory and driven from a scene.
 *
 * Callers describe what the panel should look like and stop there. Which key
 * gets which slice of a picture, what is worth re-encoding, what can be
 * skipped, and how fast an animation may run before the bus gives out — all of
 * that is decided here, against measurements rather than hope.
 */
export class PanelCompositor extends EventEmitter<PanelCompositorEvents> {
  private readonly state = new PanelState();
  /** Prepared frames by region identity, so paging back is instant. */
  private readonly animations: ByteCache<PreparedAnimation>;
  /** Regions on the panel now, playing or still. */
  private readonly playing = new Map<string, Playing>();
  /** Background preparation in flight, cancelled by falling out of the scene. */
  private readonly jobs = new Map<string, { cancelled: boolean }>();
  /** Sources held open while their remaining frames are prepared. */
  private readonly sources = new Map<string, FrameSource>();

  private readonly budget: WriteBudget;
  private readonly clock: ClockPort;

  /** Serializes everything that touches the panel, ticks included. */
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: TimerHandle;
  private running = true;

  constructor(
    private readonly panel: PanelPort,
    private readonly composer: ComposerPort,
    private readonly encoder: EncoderPort,
    private readonly format: PanelFormat,
    options: PanelCompositorOptions = {},
  ) {
    super();
    this.clock = options.clock ?? systemClock;
    this.budget = new WriteBudget(options.writesPerSecond);
    this.animations = new ByteCache(options.animationCacheBytes ?? DEFAULT_ANIMATION_CACHE_BYTES);
  }

  /** What each key physically holds. For a configurator, and for tests. */
  get panelState(): PanelState {
    return this.state;
  }

  /** Images a second the panel is currently believed to manage. */
  get measuredWritesPerSecond(): number {
    return this.budget.writesPerSecond;
  }

  /**
   * Makes the panel show this scene.
   *
   * Resolves once every key holds its first frame — the moment the scene is
   * visibly there. Animation continues in the background afterwards, so a
   * caller is never made to wait for a decode it does not need.
   */
  async present(scene: Scene): Promise<void> {
    validateScene(this.format, scene);

    const plan = planScene(this.format, scene, this.state.tileKeys());
    const wanted = new Map<string, PlannedRegion>();
    for (const planned of plan.regions) wanted.set(identityOf(planned), planned);

    this.retire(wanted);

    await this.enqueue(async () => {
      const written: number[] = [];

      for (const key of plan.cleared) {
        await this.panel.clearKey(key);
        this.state.clear(key);
      }

      for (const [identity, planned] of wanted) {
        written.push(...(await this.showFirstFrame(identity, planned)));
      }

      if (written.length > 0 || plan.cleared.length > 0) {
        this.emit('painted', [...plan.cleared, ...written]);
      }
    });

    for (const identity of wanted.keys()) this.continuePreparing(identity);
    this.driveAnimations();
  }

  /**
   * Rewrites every key from what we already hold.
   *
   * For a device that went away and came back: the pictures are still in
   * memory, so nothing is decoded, composed or encoded again.
   */
  async resync(): Promise<void> {
    await this.enqueue(async () => {
      const written: number[] = [];
      for (const [key, tile] of this.state.entries()) {
        await this.panel.writeKey(key, tile.bytes);
        written.push(key);
      }
      if (written.length > 0) this.emit('painted', written);
    });
  }

  /**
   * Stops animating, releases every open source and waits for the panel to go
   * quiet. Caches are kept.
   *
   * The waiting is the point. Writes are serialized on a chain, and whoever
   * calls this is usually about to close the device — returning while a write
   * is still in flight means it lands on a handle that is already gone, which
   * surfaces as an error on every shutdown.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) this.clock.clearTimeout(this.timer);
    this.timer = undefined;

    this.playing.clear();
    for (const job of this.jobs.values()) job.cancelled = true;
    this.jobs.clear();
    this.closeSources();

    await this.chain.catch(() => undefined);
  }

  // --- scene ----------------------------------------------------------------

  /**
   * Drops what the new scene no longer wants.
   *
   * Keyed on region identity, not on the scene: paging away and back to the
   * same picture in the same place keeps its animation playing and its frames
   * prepared, instead of throwing away work that was seconds from finishing.
   */
  private retire(wanted: ReadonlyMap<string, PlannedRegion>): void {
    for (const identity of [...this.playing.keys()]) {
      if (!wanted.has(identity)) this.playing.delete(identity);
    }

    for (const [identity, job] of [...this.jobs]) {
      if (wanted.has(identity)) continue;
      job.cancelled = true;
      this.jobs.delete(identity);
      // A job that never got as far as running still owns a decoder.
      this.sources.get(identity)?.close();
      this.sources.delete(identity);
    }

    this.animations.keepPinned(wanted.keys());
  }

  /**
   * Puts a region's first frame on its keys.
   *
   * The still goes on before anything else is decoded, always: an animated
   * source composes its first frame like any other, so the key shows the right
   * picture immediately and simply starts moving a moment later.
   */
  private async showFirstFrame(identity: string, planned: PlannedRegion): Promise<number[]> {
    // Already on the panel and still playing: writing frame 0 over it would
    // yank the animation back to its start every time an unrelated key changed.
    if (this.playing.has(identity) && planned.stale.length === 0) return [];

    const cached = this.animations.get(identity);
    if (cached && cached.ready > 0) {
      this.animations.pin(identity);
      this.play(identity, cached);
      return this.writeFrame(cached, 0);
    }

    let source: FrameSource | undefined;
    let keep = false;

    try {
      source = await this.composer.open({
        ...(planned.region.image ? { asset: planned.region.image.asset } : {}),
        ...(planned.region.image?.fit ? { fit: planned.region.image.fit } : {}),
        ...(planned.region.background === undefined
          ? {}
          : { background: planned.region.background }),
        geometry: regionGeometry(this.format, planned.region.cols, planned.region.rows),
      });

      const animated = source.frameCount > 1;
      const animation = prepareAnimation(
        planned.tiles.map((tile) => tile.key),
        planned.tiles.map((tile) => tile.tileKey),
        animated ? source.delaysMs : [0],
      );

      await this.cutFrame(source, planned, animation, 0);
      this.animations.set(identity, animation, animation.bytes);
      this.animations.pin(identity);
      this.play(identity, animation);

      if (animated) {
        // Kept open: the remaining frames continue from here, and reopening
        // would replay the decode from the first frame.
        this.jobs.set(identity, { cancelled: false });
        this.sources.set(identity, source);
        this.pending.set(identity, planned);
        keep = true;
      }

      return this.writeFrame(animation, 0);
    } catch (error) {
      this.emit('error', error as Error);
      return [];
    } finally {
      if (!keep) source?.close();
    }
  }

  /** Regions whose remaining frames are yet to be asked for. */
  private readonly pending = new Map<string, PlannedRegion>();

  /**
   * Prepares the frames after the first, in the background.
   *
   * Deliberately not awaited by `present`. The scene is already visible; these
   * only make it move, and blocking on them is what made opening a page with a
   * stretched GIF take seconds.
   */
  private continuePreparing(identity: string): void {
    const source = this.sources.get(identity);
    const planned = this.pending.get(identity);
    const job = this.jobs.get(identity);
    const animation = this.animations.get(identity);
    if (!source || !planned || !job || !animation) return;

    this.sources.delete(identity);
    this.pending.delete(identity);

    void (async () => {
      try {
        for (let index = 1; index < source.frameCount; index++) {
          if (job.cancelled || !this.running) return;

          await this.cutFrame(source, planned, animation, index);
          this.animations.set(identity, animation, animation.bytes);

          // Each finished frame lengthens the loop, so a picture starts moving
          // long before all of it is ready.
          this.driveAnimations();

          // Composing and encoding are CPU-bound and synchronous; without
          // handing control back, a long animation would hold the thread for
          // its whole duration and the panel would stop responding.
          await new Promise((resolve) => setImmediate(resolve));
        }
      } catch (error) {
        this.emit('error', error as Error);
      } finally {
        source.close();
        this.jobs.delete(identity);
      }
    })();
  }

  /** Composes one frame of a region and encodes every key's share of it. */
  private async cutFrame(
    source: FrameSource,
    planned: PlannedRegion,
    animation: PreparedAnimation,
    index: number,
  ): Promise<void> {
    const composed = await source.composeFrame(index);
    const tiles: Uint8Array[] = [];
    let quality: number | undefined;

    for (const tile of planned.tiles) {
      const label = toTileLabel(planned, tile.col, tile.row);

      const bitmap = await this.composer.cutTile(composed, {
        col: tile.col,
        row: tile.row,
        corners: cornersOf(planned.region, tile.col, tile.row),
        ...(planned.region.cornerRadius === undefined
          ? {}
          : { cornerRadius: planned.region.cornerRadius }),
        ...(label ? { label } : {}),
      });

      const encoded = await this.encoder.encode(bitmap, {
        maxBytes: this.format.maxTileBytes,
        ...(quality === undefined ? {} : { startQuality: quality }),
      });

      quality = encoded.quality;
      tiles.push(encoded.bytes);
      animation.bytes += encoded.bytes.byteLength;
    }

    animation.frames[index] = tiles;
    animation.ready = Math.max(animation.ready, index + 1);
  }

  private closeSources(): void {
    for (const source of this.sources.values()) source.close();
    this.sources.clear();
    this.pending.clear();
  }

  // --- writing --------------------------------------------------------------

  /** Writes one frame of an animation, skipping keys that already hold it. */
  private async writeFrame(animation: PreparedAnimation, index: number): Promise<number[]> {
    const frame = animation.frames[index];
    if (!frame) return [];

    const written: number[] = [];
    const started = this.clock.now();

    for (let cell = 0; cell < animation.keys.length; cell++) {
      const key = animation.keys[cell]!;
      const bytes = frame[cell]!;
      const tileKey = animation.tileKeys[cell]!;

      if (this.state.holds(key, tileKey, index)) continue;

      /*
       * Byte-identical to what is already there. Comparing a few kilobytes
       * costs microseconds and a write costs milliseconds of the scarcest
       * resource there is, so this is worth doing even where it rarely hits —
       * and on a picture that animates in one corner it hits constantly.
       */
      const held = this.state.get(key);
      if (held && sameBytes(held.bytes, bytes)) {
        this.state.set(key, { tileKey, frameIndex: index, bytes });
        continue;
      }

      await this.panel.writeKey(key, bytes);
      this.state.set(key, { tileKey, frameIndex: index, bytes });
      written.push(key);
    }

    this.budget.record(written.length, this.clock.now() - started);
    return written;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.catch(() => undefined);
    return result;
  }

  // --- animation ------------------------------------------------------------

  private play(identity: string, animation: PreparedAnimation): void {
    if (this.playing.has(identity)) return;
    this.playing.set(identity, { animation, startedAt: this.clock.now(), shown: 0 });
  }

  private driveAnimations(): void {
    if (!this.running || this.timer) return;
    if (![...this.playing.values()].some((entry) => entry.animation.ready > 1)) return;

    this.scheduleTick(0);
  }

  /**
   * Ticks run on the same chain as scene painting, not one of their own.
   *
   * Both write to the panel, and two chains interleave: a tick already
   * awaiting a write would resume *after* a repaint had replaced that key, put
   * its stale frame back, and leave the key wrong for good — the repaint has
   * already recorded the key as up to date, so nothing would correct it.
   */
  private scheduleTick(delayMs: number): void {
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      void this.enqueue(() => this.runTick());
    }, delayMs);
  }

  private async runTick(): Promise<void> {
    if (!this.running || this.playing.size === 0) return;

    const written: number[] = [];
    try {
      const now = this.clock.now();

      for (const entry of this.playing.values()) {
        const index = frameAt(entry.animation, entry.startedAt, now);
        if (index === entry.shown) continue;
        if (!entry.animation.frames[index]) continue;

        written.push(...(await this.writeFrame(entry.animation, index)));
        entry.shown = index;
      }
    } catch (error) {
      this.emit('error', error as Error);
    }

    if (written.length > 0) this.emit('painted', written);
    if (!this.running || this.playing.size === 0) return;

    this.scheduleTick(this.nextTickDelay());
  }

  /**
   * When to wake next: what the pictures ask for, or what the bus can carry —
   * whichever is later.
   *
   * This is the whole answer to the panel falling behind. A 30fps picture over
   * fifteen keys wants a tick every 33ms and needs 15 writes to service it,
   * which at the measured rate takes about 64ms. Waking every 33ms adds work
   * faster than the bus removes it, and the queue grows for as long as the
   * animation runs — with every key press stuck behind it. Waking every 64ms
   * shows every second frame instead: the animation keeps time, because frames
   * come from the clock, and only smoothness is given up.
   */
  private nextTickDelay(): number {
    const now = this.clock.now();
    let soonest = Number.POSITIVE_INFINITY;
    let keysInMotion = 0;

    for (const entry of this.playing.values()) {
      if (entry.animation.ready <= 1) continue;
      soonest = Math.min(soonest, nextChangeMs(entry.animation, entry.startedAt, now));
      keysInMotion += entry.animation.keys.length;
    }

    if (!Number.isFinite(soonest)) return MIN_TICK_MS;
    return Math.max(MIN_TICK_MS, Math.round(soonest), Math.round(this.budget.costMs(keysInMotion)));
  }
}

/**
 * Identity of a region on the panel: its picture, its geometry, its labels and
 * *where it is*.
 *
 * The position matters. Two identical buttons in different places produce the
 * same tiles, and identity without position would fold them into one — leaving
 * the second one blank.
 */
function identityOf(planned: PlannedRegion): string {
  return digest([
    planned.regionKey,
    String(planned.region.key),
    ...planned.tiles.map((tile) => tile.tileKey),
  ]);
}

function toTileLabel(planned: PlannedRegion, col: number, row: number): TileLabel | undefined {
  const label = labelAt(planned.region, col, row);
  if (!label) return undefined;

  return {
    text: label.text,
    ...(label.color === undefined ? {} : { color: label.color }),
    ...(label.fontFamily === undefined ? {} : { fontFamily: label.fontFamily }),
    ...(label.fontSize === undefined ? {} : { fontSize: label.fontSize }),
    ...(label.position === undefined ? {} : { position: label.position }),
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
