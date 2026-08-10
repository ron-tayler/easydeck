import { EventEmitter } from 'node:events';

import { digest } from '../domain/digest.js';
import { alertAt, cornersOf, labelAt, validateScene } from '../domain/scene.js';
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
  /**
   * Where to write a line about what happened to a key, if anywhere.
   *
   * Only the rare, decisive events — a finger arriving or leaving, a scene
   * clearing a key, a smaller copy drawn or discarded. Animation frames are
   * deliberately absent: at thirty a second they would bury the one line that
   * explains why a key is showing the wrong thing.
   */
  readonly trace?: (event: string, detail?: Readonly<Record<string, unknown>>) => void;
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
/**
 * How much of itself a key shows while it is held down.
 *
 * The deck has no travel and no click, so the only way it can acknowledge a
 * finger is to change what it shows. A fifth smaller reads clearly at arm's
 * length without looking like the picture changed.
 */
const PRESSED_SCALE = 0.8;

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
  /** Keys currently held down, and what they would show if they were not. */
  /**
   * Keys with a finger on them.
   *
   * `resting` is what goes back on release, and it moves with the world: a
   * scene change or an animation frame that lands on a held key is recorded
   * here instead of being drawn. `drawnFrom` is the picture the smaller copy
   * currently on the panel was made from — the two differing is exactly what
   * "this key is showing something out of date" means.
   */
  private readonly pressed = new Map<number, { resting: Uint8Array; drawnFrom?: Uint8Array }>();

  /**
   * Keys the last scene change cleared.
   *
   * Kept only so a write that lands on one can be reported. A key that has
   * been cleared and then written to is the difference between "the panel
   * ignored the clear" and "something painted over it afterwards", and from
   * the outside the two look identical.
   */
  private clearedRecently = new Set<number>();
  /** An encoded empty key, made once on the first clear and reused. */
  private blank?: Uint8Array;

  /** Says what happened to a key, where anyone is listening. */
  private trace(event: string, detail?: Readonly<Record<string, unknown>>): void {
    this.options.trace?.(event, detail);
  }

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
    private readonly options: PanelCompositorOptions = {},
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

      this.trace('present', {
        cleared: plan.cleared,
        regions: [...wanted.values()].map((planned) => planned.region.key),
        pressed: [...this.pressed.keys()],
      });

      // Only the keys this pass emptied; anything the new scene covers is no
      // longer "cleared", and reporting writes to it would be noise.
      this.clearedRecently = new Set(plan.cleared);

      const blank = plan.cleared.length > 0 ? await this.blankTile() : undefined;

      for (const key of plan.cleared) {
        /*
         * Painted black rather than cleared.
         *
         * The panel has a clear-one-key command and it does not take: a key
         * emptied that way went on showing whatever it had — the frame a GIF
         * had reached, the smaller copy drawn under a finger — for as long as
         * the deck stayed on. Writing black is a few kilobytes over the bus
         * against a picture that outlives the page it belonged to.
         */
        if (blank) await this.panel.writeKey(key, blank);
        else await this.panel.clearKey(key);

        this.state.clear(key);
      }

      for (const [identity, planned] of wanted) {
        written.push(...(await this.showFirstFrame(identity, planned)));
      }

      if (written.length > 0 || plan.cleared.length > 0) {
        this.emit('painted', [...plan.cleared, ...written]);
      }

      await this.refreshPressed();
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
   * Shows a key as held down, or lets it go.
   *
   * Driven by contact and release rather than by gestures: this is what the
   * finger is doing right now, not what it will turn out to have meant. A key
   * that is animating stops while it is held — its frames keep arriving and
   * the newest is remembered, so letting go shows the animation where it got
   * to rather than where it was pressed.
   */
  async setPressed(key: number, pressed: boolean): Promise<void> {
    if (pressed === this.pressed.has(key)) return;

    if (!pressed) {
      const entry = this.pressed.get(key);
      this.pressed.delete(key);
      this.trace('release', { key, restored: Boolean(entry) });
      if (entry) await this.enqueue(() => this.writeTile(key, entry.resting));
      return;
    }

    const held = this.state.get(key);
    this.trace('press', { key, hasTile: Boolean(held) });
    if (!held) return;

    this.pressed.set(key, { resting: held.bytes });
    await this.enqueue(() => this.drawPressed(key, held.bytes));
  }

  /**
   * Draws one key smaller, as the acknowledgement of a finger on it.
   *
   * Checked against the finger twice, before and after the work. Shrinking and
   * encoding take a moment, and a quick tap is over inside it: without the
   * second check this wrote the smaller copy *after* the release had already
   * put the key back, and — worse — recorded the key as held again. Nothing
   * would ever release it after that, so it sat there wearing the frozen
   * picture through every page that followed.
   */
  private async drawPressed(key: number, resting: Uint8Array): Promise<void> {
    if (!this.pressed.has(key)) {
      this.trace('shrink-skipped', { key, when: 'before' });
      return;
    }

    try {
      const bitmap = await this.composer.shrinkTile(resting, {
        width: this.format.tileWidth,
        height: this.format.tileHeight,
        scale: PRESSED_SCALE,
      });
      const encoded = await this.encoder.encode(bitmap, { maxBytes: this.format.maxTileBytes });

      if (!this.pressed.has(key)) {
        this.trace('shrink-skipped', { key, when: 'after' });
        return;
      }

      this.pressed.set(key, { resting, drawnFrom: resting });
      this.trace('shrink-written', { key });
      await this.writeTile(key, encoded.bytes);
    } catch (error) {
      // Feedback is a courtesy: failing to shrink a key must not disturb what
      // it shows, and certainly must not take the panel down.
      this.emit('error', error as Error);
    }
  }

  /**
   * Brings held keys up to date with what the scene now says.
   *
   * A pressed key is frozen: the picture behind it is remembered so releasing
   * can put it back. When the scene changes underneath that — a page turn, a
   * button switching state — the remembered picture is the *old* one, and
   * releasing pasted it back over the new page. A GIF made it worse: whatever
   * frame it had reached was remembered too, and surfaced on a page it never
   * belonged to.
   *
   * So the memory follows the scene. A key still on screen is redrawn held
   * down from its new picture — which is also the answer to a state changing
   * under a finger, where the key used to sit unchanged until released. A key
   * the new scene has nothing for is simply forgotten.
   */
  private async refreshPressed(): Promise<void> {
    for (const [key, entry] of [...this.pressed]) {
      if (!this.state.get(key)) {
        this.pressed.delete(key);
        this.trace('pressed-forgotten', { key });
        continue;
      }

      if (entry.drawnFrom && sameBytes(entry.drawnFrom, entry.resting)) continue;

      this.trace('pressed-refreshed', { key });
      await this.drawPressed(key, entry.resting);
    }
  }

  /**
   * A key with nothing on it, encoded once and kept.
   *
   * Composed exactly as a region with no picture would be — the background the
   * renderer falls back to — so an emptied key looks like an empty key rather
   * than like something this file invented.
   */
  private async blankTile(): Promise<Uint8Array | undefined> {
    if (this.blank) return this.blank;

    try {
      const source = await this.composer.open({ geometry: regionGeometry(this.format, 1, 1) });
      try {
        const bitmap = await this.composer.cutTile(await source.composeFrame(0), {
          col: 0,
          row: 0,
          corners: { topLeft: true, topRight: true, bottomRight: true, bottomLeft: true },
        });
        const encoded = await this.encoder.encode(bitmap, { maxBytes: this.format.maxTileBytes });
        this.blank = encoded.bytes;
      } finally {
        source.close();
      }
    } catch (error) {
      // Falls back to the panel's own clear, which is better than nothing.
      this.emit('error', error as Error);
    }

    return this.blank;
  }

  /** Puts bytes on a key without disturbing what the scene thinks is there. */
  private async writeTile(key: number, bytes: Uint8Array): Promise<void> {
    if (this.clearedRecently.has(key)) this.trace('write-after-clear', { key });

    const held = this.state.get(key);
    await this.panel.writeKey(key, bytes);
    if (held) this.state.set(key, { ...held, bytes });
    this.emit('painted', [key]);
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
    this.pressed.clear();
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
        // Where an unpositioned label goes depends on what is under it.
        ...(planned.region.image ? { hasPicture: true } : {}),
        ...(alertAt(planned.region, tile.col, tile.row) ? { alert: true } : {}),
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
       * Held down: the key is showing the pressed picture, and overwriting it
       * with an animation frame would cancel the only feedback the deck has.
       * The frame is remembered instead, so releasing shows where the
       * animation actually got to.
       */
      const pressed = this.pressed.get(key);
      if (pressed) {
        this.trace('frame-held-back', { key, frame: index });
        this.pressed.set(key, { ...pressed, resting: bytes });
        const held = this.state.get(key);
        if (held) this.state.set(key, { ...held, tileKey, frameIndex: index });
        continue;
      }

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

      if (this.clearedRecently.has(key)) this.trace('frame-after-clear', { key, frame: index });

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
