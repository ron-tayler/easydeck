import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PanelFormat } from '../domain/panel-format.js';
import type { Scene } from '../domain/scene.js';
import { PanelCompositor } from './panel-compositor.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';
import type {
  ComposedRegion,
  ComposerPort,
  CutTileRequest,
  FrameSource,
  OpenRequest,
  ShrinkTileRequest,
  TileBitmap,
} from './ports/composer-port.js';
import type { EncoderPort } from './ports/encoder-port.js';
import type { PanelPort } from './ports/panel-port.js';

const FORMAT: PanelFormat = {
  rows: 3,
  cols: 5,
  tileWidth: 112,
  tileHeight: 112,
  gap: 14,
  rotationDegrees: 180,
  maxTileBytes: 10240,
};

/** Fourth byte of a tile: 1 when a label was drawn, 9 when it was shrunk. */
const PRESSED_MARK = 9;
/** Marks the tile written to a key the scene has emptied. */
const BLANK_MARK = 7;

const GIF = { id: 'sha1-gif', source: 'cat.gif' };
const STILL = { id: 'sha1-png', source: 'cat.png' };
const OTHER = { id: 'sha1-dog', source: 'dog.png' };

class FakeClock implements ClockPort {
  private time = 0;
  private sequence = 0;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(handler: () => void, delayMs: number): TimerHandle {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.time + delayMs, run: handler });
    return id as unknown as TimerHandle;
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle as unknown as number);
  }

  /** The delay of the timer waiting to fire, if any. */
  pendingDelay(): number | undefined {
    const next = [...this.timers.values()].sort((a, b) => a.at - b.at)[0];
    return next ? next.at - this.time : undefined;
  }

  async advance(ms: number): Promise<void> {
    const until = this.time + ms;

    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;

      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].run();
      await flush();
    }

    this.time = until;
    await flush();
  }
}

/** Whether a key was emptied — painted blank, rather than merely told to clear. */
function blanked(panel: FakePanel, key: number): boolean {
  const last = panel.writes.filter((write) => write.key === key).at(-1);
  return last?.bytes.at(-1) === BLANK_MARK;
}

/** Lets background preparation, which yields between frames, run to completion. */
async function flush(rounds = 60): Promise<void> {
  for (let index = 0; index < rounds; index++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

class FakeComposer implements ComposerPort {
  opens = 0;
  closes = 0;
  /** Frames composed, as `frameIndex` values, in order. */
  readonly composed: number[] = [];

  constructor(
    private readonly frames: number,
    private readonly delayMs = 100,
  ) {}

  async open(request: OpenRequest): Promise<FrameSource> {
    this.opens++;
    const animated = request.asset?.id === GIF.id;
    const frameCount = animated ? this.frames : 1;

    return {
      frameCount,
      delaysMs: animated ? new Array<number>(frameCount).fill(this.delayMs) : [0],
      composeFrame: async (index: number): Promise<ComposedRegion> => {
        this.composed.push(index);
        return {
          width: request.geometry.width,
          height: request.geometry.height,
          index,
          // Which picture this came from, so two different assets produce
          // tiles that can be told apart.
          asset: request.asset?.id ?? 'blank',
        } as never;
      },
      close: () => {
        this.closes++;
      },
    };
  }

  /** Held open to model a shrink that outlives the press that asked for it. */
  holdShrink = false;
  private waiting?: () => void;

  releaseShrink(): void {
    this.waiting?.();
    this.waiting = undefined;
    this.holdShrink = false;
  }

  /** Marks the tile as shrunk, so a pressed key is recognisable in a write. */
  async shrinkTile(tile: Uint8Array, request: ShrinkTileRequest): Promise<TileBitmap> {
    if (this.holdShrink) await new Promise<void>((resolve) => (this.waiting = resolve));

    return {
      width: request.width,
      height: request.height,
      // Keeps frame, cell and picture; the label bit gives way to the mark,
      // which is all a pressed-key check needs.
      data: Uint8Array.from([...tile.slice(0, 3), tile[4] ?? 0, PRESSED_MARK]),
    };
  }

  async cutTile(region: ComposedRegion, request: CutTileRequest): Promise<TileBitmap> {
    const { index, asset } = region as unknown as { index: number; asset: string };
    // Pixels that identify the frame, the cell and the picture they came from,
    // so a write can be checked for being the right slice of the right frame
    // of the right picture.
    return {
      width: FORMAT.tileWidth,
      height: FORMAT.tileHeight,
      data: new Uint8Array([
        index,
        request.col,
        request.row,
        request.label ? 1 : 0,
        asset === OTHER.id ? 2 : asset === GIF.id ? 1 : asset === 'blank' ? BLANK_MARK : 0,
      ]),
    };
  }
}

/** Passes the identifying pixels straight through, so writes stay checkable. */
const encoder: EncoderPort = {
  encode: async (tile) => ({ bytes: Uint8Array.from(tile.data), quality: 90 }),
};

class FakePanel implements PanelPort {
  readonly writes: { key: number; bytes: Uint8Array }[] = [];
  readonly cleared: number[] = [];

  async writeKey(key: number, image: Uint8Array): Promise<void> {
    this.writes.push({ key, bytes: Uint8Array.from(image) });
  }

  async clearKey(key: number): Promise<void> {
    this.cleared.push(key);
  }
}

function build(frames = 1, delayMs = 100) {
  const panel = new FakePanel();
  const composer = new FakeComposer(frames, delayMs);
  const clock = new FakeClock();
  const compositor = new PanelCompositor(panel, composer, encoder, FORMAT, {
    clock,
    writesPerSecond: 233,
  });
  compositor.on('error', () => undefined);
  return { panel, composer, clock, compositor };
}

const STRETCHED: Scene = { regions: [{ key: 0, cols: 3, rows: 2, image: { asset: GIF } }] };

test('a scene puts a picture on every key it covers', async () => {
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 3, rows: 2, image: { asset: STILL } }] });

  assert.deepEqual(panel.writes.map((write) => write.key), [0, 1, 2, 5, 6, 7]);
});

test('a stretched picture is composed once, not once per key', async () => {
  // The whole point: the old path laid the picture out again for every key.
  const { composer, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 3, rows: 2, image: { asset: STILL } }] });

  assert.equal(composer.opens, 1);
  assert.deepEqual(composer.composed, [0]);
});

test('each key gets its own slice', async () => {
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 2, rows: 1, image: { asset: STILL } }] });

  // frame, column, row, label, picture
  assert.deepEqual([...panel.writes[0]!.bytes], [0, 0, 0, 0, 0]);
  assert.deepEqual([...panel.writes[1]!.bytes], [0, 1, 0, 0, 0]);
});

test('presenting the same scene again writes nothing', async () => {
  const { panel, compositor } = build();
  const scene: Scene = { regions: [{ key: 0, cols: 3, rows: 2, image: { asset: STILL } }] };

  await compositor.present(scene);
  const after = panel.writes.length;
  await compositor.present(scene);

  assert.equal(panel.writes.length, after);
});

test('changing one label rewrites one key', async () => {
  const { panel, compositor } = build();
  const region = { key: 0, cols: 3, rows: 2, image: { asset: STILL } };

  await compositor.present({ regions: [region] });
  const after = panel.writes.length;

  await compositor.present({
    regions: [{ ...region, labels: [{ col: 1, row: 0, text: '42' }] }],
  });

  assert.deepEqual(panel.writes.slice(after).map((write) => write.key), [1]);
});

test('keys the new scene does not cover are emptied', async () => {
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 3, rows: 2, image: { asset: STILL } }] });
  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });

  for (const key of [1, 2, 5, 6, 7]) {
    assert.ok(blanked(panel, key), `key ${key} kept what it had`);
  }
  assert.ok(!blanked(panel, 0), 'the key the new scene covers was emptied too');
});

test('an animation starts on its first frame and moves on the clock', async () => {
  const { panel, clock, compositor } = build(4, 100);

  await compositor.present(STRETCHED);
  // Frame 0 on all six keys, before a single further frame is decoded.
  assert.deepEqual(panel.writes.map((write) => write.key), [0, 1, 2, 5, 6, 7]);
  assert.ok(panel.writes.every((write) => write.bytes[0] === 0));

  await flush();
  await clock.advance(100);

  const moved = panel.writes.filter((write) => write.bytes[0] !== 0);
  assert.ok(moved.length > 0, 'the animation never advanced');
});

test('a still is never given a timer', async () => {
  const { clock, compositor } = build(1);

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  await flush();

  assert.equal(clock.pendingDelay(), undefined);
});

test('playback is capped by what the bus can carry', async () => {
  // Fifteen keys at 30fps ask for 451 images a second against a ceiling of
  // 233. Asking anyway is what made the panel fall seconds behind: each tick
  // queued more work than the bus removed, for as long as the animation ran.
  const { panel, clock, compositor } = build(10, 33);

  await compositor.present({ regions: [{ key: 0, cols: 5, rows: 3, image: { asset: GIF } }] });
  await flush();
  panel.writes.length = 0;

  await clock.advance(1000);

  assert.ok(panel.writes.length > 100, `the animation barely ran: ${panel.writes.length} writes`);
  assert.ok(
    panel.writes.length <= 233,
    `asked the bus for ${panel.writes.length} images in a second against a ceiling of 233`,
  );
});

test('an animation plays the frames prepared so far', async () => {
  // Standing still until every frame is encoded reads as a freeze; the loop
  // lengthens as frames arrive instead.
  const { panel, clock, compositor } = build(30, 100);

  await compositor.present(STRETCHED);
  await new Promise((resolve) => setImmediate(resolve));
  await clock.advance(100);

  assert.ok(panel.writes.some((write) => write.bytes[0] === 1), 'never left the first frame');
});

test('a tile identical to the one on the key is not written again', async () => {
  const { panel, clock, compositor } = build(4, 100);
  await compositor.present(STRETCHED);
  await flush();

  const before = panel.writes.length;
  // The clock has not moved, so every key already holds the right frame.
  await clock.advance(0);

  assert.equal(panel.writes.length, before);
});

test('paging away cancels preparation that is no longer wanted', async () => {
  const { composer, compositor } = build(40, 100);

  await compositor.present(STRETCHED);
  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  await flush();

  // The abandoned decoder is released rather than left running to the end.
  assert.ok(composer.closes >= 1, 'the abandoned source was never closed');
});

test('paging back to the same picture reuses what was prepared', async () => {
  const { composer, compositor } = build(4, 100);

  await compositor.present(STRETCHED);
  await flush();
  const opens = composer.opens;

  await compositor.present({ regions: [{ key: 9, cols: 1, rows: 1, image: { asset: STILL } }] });
  await compositor.present(STRETCHED);
  await flush();

  // The still, and the one composition of the empty key that leaving made
  // necessary — but not the animation, which was kept.
  assert.equal(composer.opens, opens + 2, 'the picture was decoded again on the way back');
});

test('a reconnected panel is refilled from memory, not re-rendered', async () => {
  const { panel, composer, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 3, rows: 2, image: { asset: STILL } }] });
  const opens = composer.opens;
  panel.writes.length = 0;

  await compositor.resync();

  assert.equal(panel.writes.length, 6);
  assert.equal(composer.opens, opens, 'resync re-opened the picture');
});

test('stopping releases every open source', async () => {
  const { composer, compositor } = build(40, 100);

  await compositor.present(STRETCHED);
  await compositor.stop();
  await flush();

  assert.ok(composer.closes >= 1);
});

test('a held key shrinks, and grows back when released', async () => {
  // The deck has no travel and no click: changing what the key shows is the
  // only acknowledgement it can give a finger.
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  const resting = panel.writes.at(-1)!.bytes;

  await compositor.setPressed(0, true);
  assert.equal(panel.writes.at(-1)!.bytes.at(-1), PRESSED_MARK, 'the key did not shrink');

  await compositor.setPressed(0, false);
  assert.deepEqual(panel.writes.at(-1)!.bytes, resting, 'the key did not come back');
});

test('pressing a key twice writes it once', async () => {
  const { panel, compositor } = build();
  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });

  await compositor.setPressed(0, true);
  const after = panel.writes.length;
  await compositor.setPressed(0, true);

  assert.equal(panel.writes.length, after);
});

test('an animation does not overwrite the key being held', async () => {
  const { panel, clock, compositor } = build(4, 100);
  await compositor.present(STRETCHED);
  await flush();

  await compositor.setPressed(0, true);
  const afterPress = panel.writes.length;

  await clock.advance(300);

  const wrote = panel.writes.slice(afterPress).filter((write) => write.key === 0);
  assert.deepEqual(wrote, [], 'frames landed on a key that was being held');
});

test('releasing shows where the animation got to, not where it was pressed', async () => {
  const { panel, clock, compositor } = build(4, 100);
  await compositor.present(STRETCHED);
  await flush();

  await compositor.setPressed(0, true);
  await clock.advance(200);
  await compositor.setPressed(0, false);

  const last = panel.writes.at(-1)!;
  assert.equal(last.key, 0);
  assert.notEqual(last.bytes[0], 0, 'came back showing the frame it was pressed on');
});

test('a key with nothing on it cannot be pressed into anything', async () => {
  const { panel, compositor } = build();

  await compositor.setPressed(3, true);

  assert.deepEqual(panel.writes, []);
});

test('a failing picture does not take the panel down', async () => {
  const panel = new FakePanel();
  const failing: ComposerPort = {
    open: async () => {
      throw new Error('no such picture');
    },
    cutTile: async () => {
      throw new Error('unreachable');
    },
    shrinkTile: async () => {
      throw new Error('unreachable');
    },
  };

  const compositor = new PanelCompositor(panel, failing, encoder, FORMAT, { clock: new FakeClock() });
  const errors: Error[] = [];
  compositor.on('error', (error) => errors.push(error));

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });

  assert.equal(errors.length, 1);
  assert.equal(panel.writes.length, 0);
});

test('a key held through a scene change comes back as the new scene, not the old', async () => {
  // Releasing used to paste back the picture from before the press — a page
  // that had since been left behind, over the page now on screen.
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  const resting = panel.writes.at(-1)!.bytes;
  await compositor.setPressed(0, true);

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: OTHER } }] });

  // Still held, so what is on the key now is the smaller copy of the new
  // picture — the point of the fix.
  assert.equal(panel.writes.at(-1)!.bytes.at(-1), PRESSED_MARK);

  await compositor.setPressed(0, false);
  const released = panel.writes.at(-1)!.bytes;

  assert.notEqual(released.at(-1), PRESSED_MARK, 'released to the smaller copy');
  assert.notDeepEqual(released, resting, 'released to the picture from the page it left');
});

test('a key held while its picture changes is redrawn, still held', async () => {
  // A state switching under a finger used to leave the key showing the old
  // picture until it was let go.
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  await compositor.setPressed(0, true);
  const heldOld = panel.writes.at(-1)!.bytes;

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: OTHER } }] });

  const now = panel.writes.at(-1)!;
  assert.equal(now.key, 0);
  assert.equal(now.bytes.at(-1), PRESSED_MARK, 'redrawn, but not as held');
  assert.notDeepEqual(now.bytes, heldOld, 'the held key still shows the old picture');
});

test('a scene that drops a held key forgets it', async () => {
  // Otherwise releasing would write a picture onto a key the scene has
  // cleared, and nothing would ever correct it.
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  await compositor.setPressed(0, true);

  await compositor.present({ regions: [] });
  const before = panel.writes.length;

  await compositor.setPressed(0, false);

  assert.equal(panel.writes.length, before, 'wrote to a key the scene had cleared');
});

test('leaving a page clears a key the new page has nothing for, even mid-press', async () => {
  // Pressing a key that navigates away, from a page where it was animating:
  // the key belongs to nobody now and must go dark, not keep the frame it
  // happened to be showing.
  const { panel, clock, compositor } = build(4, 100);

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: GIF } }] });
  await flush();
  await clock.advance(150);

  await compositor.setPressed(0, true);
  await compositor.present({ regions: [{ key: 4, cols: 1, rows: 1, image: { asset: STILL } }] });
  await compositor.setPressed(0, false);
  await flush();
  await clock.advance(300);

  assert.ok(blanked(panel, 0), 'the key was never emptied');

  const afterClear = panel.writes.filter((write) => write.key === 0).length;
  const clearedAt = panel.writes.length;
  await clock.advance(300);
  await flush();

  assert.equal(
    panel.writes.slice(clearedAt).filter((write) => write.key === 0).length,
    0,
    'a frame landed on a key the scene had cleared',
  );
  assert.ok(afterClear >= 0);
});

test('releasing after the scene moved on does not paint a departed key', async () => {
  // The order the panel actually produces: the gesture fires first — taking
  // the deck somewhere else — and the release lands afterwards. A key the new
  // page has nothing for must stay dark rather than take back the frame it
  // was showing when it was pressed.
  const { panel, clock, compositor } = build(4, 100);

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: GIF } }] });
  await flush();
  await clock.advance(150);

  await compositor.setPressed(0, true);

  // Navigation happens on the gesture, which is delivered before the release.
  await compositor.present({ regions: [{ key: 4, cols: 1, rows: 1, image: { asset: STILL } }] });
  const afterScene = panel.writes.length;

  await compositor.setPressed(0, false);
  await flush();

  assert.ok(blanked(panel, 0), 'the key was never emptied');
  assert.equal(
    panel.writes.slice(afterScene).filter((write) => write.key === 0).length,
    0,
    'the release painted a key the new page had cleared',
  );
});

test('a page that covers fewer keys clears the ones an animation had', async () => {
  // A stretched GIF leaves keys behind when the next page is smaller: they
  // held frames, and nothing else is going to write to them.
  const { panel, clock, compositor } = build(4, 100);

  await compositor.present({ regions: [{ key: 0, cols: 3, rows: 2, image: { asset: GIF } }] });
  await flush();
  await clock.advance(250);

  await compositor.setPressed(0, true);
  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  await compositor.setPressed(0, false);
  await flush();
  await clock.advance(400);

  // Every key the big region had, except the one the small region keeps.
  for (const key of [1, 2, 5, 6, 7]) {
    assert.ok(blanked(panel, key), `key ${key} kept its frame`);
  }
});

test('a shrink that finishes after the release is thrown away', async () => {
  // The queue can be busy when a key goes down — a scene being written, a GIF
  // being cut — so the smaller copy is sometimes produced after the finger has
  // already gone. Writing it then would leave the key wearing a frozen picture,
  // and marking it held again would mean nothing ever released it.
  const { panel, composer, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  const resting = panel.writes.at(-1)!.bytes;

  composer.holdShrink = true;
  const down = compositor.setPressed(0, true);
  await compositor.setPressed(0, false);

  composer.releaseShrink();
  await down;
  await flush();

  assert.deepEqual(panel.writes.at(-1)!.bytes, resting, 'the late shrink landed anyway');

  await compositor.present({ regions: [] });
  assert.ok(blanked(panel, 0), 'the key was still thought to be held');
});

test('a tap over before the shrink lands leaves the key alone', async () => {
  // A quick press finishes inside the time it takes to shrink and encode. The
  // smaller copy must not arrive after the release — and must certainly not
  // mark the key as held again, which left it frozen through every page after.
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  const resting = panel.writes.at(-1)!.bytes;

  // Both halves of the tap before the queue is given a chance to run.
  const down = compositor.setPressed(0, true);
  const up = compositor.setPressed(0, false);
  await Promise.all([down, up]);
  await flush();

  assert.deepEqual(panel.writes.at(-1)!.bytes, resting, 'the key was left shrunk');

  // And the scene can still take the key away afterwards.
  await compositor.present({ regions: [] });
  assert.ok(blanked(panel, 0), 'the key stayed behind, still thought to be held');
});

test('an emptied key is painted, not just told to clear', async () => {
  // The panel's clear-one-key command does not take: a key emptied that way
  // kept showing whatever it had — a GIF frame, the smaller copy drawn under
  // a finger — for as long as the deck stayed on that page.
  const { panel, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  const before = panel.writes.length;

  await compositor.present({ regions: [] });

  const written = panel.writes.slice(before).filter((write) => write.key === 0);
  assert.equal(written.length, 1, 'the key was left to the clear command alone');
});

test('the empty key is encoded once, however many keys are emptied', async () => {
  const { panel, composer, compositor } = build();

  await compositor.present({ regions: [{ key: 0, cols: 3, rows: 2, image: { asset: STILL } }] });
  const composedBefore = composer.composed.length;

  await compositor.present({ regions: [] });
  await compositor.present({ regions: [{ key: 0, cols: 1, rows: 1, image: { asset: STILL } }] });
  await compositor.present({ regions: [] });

  // One composition for the blank, plus the one that put the picture back.
  assert.ok(
    composer.composed.length - composedBefore <= 2,
    `composed ${composer.composed.length - composedBefore} times for two clears`,
  );
});
