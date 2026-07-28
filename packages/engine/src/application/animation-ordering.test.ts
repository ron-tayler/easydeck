import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '../domain/profile.js';
import type { ProfileDefinition } from '../domain/profile.js';
import type { ButtonVisual } from '../domain/visual.js';
import { ActionRegistry } from './action-registry.js';
import { DeckController } from './deck-controller.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';
import type { AnimatedFrame, KeyRendererPort } from './ports/renderer-port.js';
import type { SurfacePort } from './ports/surface-port.js';

/**
 * A surface whose writes take a turn of the event loop, so anything writing
 * concurrently would visibly interleave in the log.
 */
class SlowSurface implements SurfacePort {
  readonly layout = { rows: 1, cols: 3 };
  readonly log: string[] = [];

  onKeyDown(): () => void {
    return () => {};
  }
  onKeyUp(): () => void {
    return () => {};
  }

  async setKeyImage(key: number, image: Uint8Array): Promise<void> {
    const what = Buffer.from(image).toString('utf8');
    this.log.push(`start ${key}:${what}`);
    await Promise.resolve();
    await Promise.resolve();
    this.log.push(`end   ${key}:${what}`);
  }

  async clearKey(key: number): Promise<void> {
    this.log.push(`clear ${key}`);
  }
}

class Clock implements ClockPort {
  private pending: (() => void)[] = [];
  time = 0;

  now(): number {
    return this.time;
  }
  setTimeout(callback: () => void): TimerHandle {
    this.pending.push(callback);
    return this.pending.length;
  }
  clearTimeout(): void {}

  fire(): void {
    const due = this.pending;
    this.pending = [];
    for (const callback of due) callback();
  }
}

const renderer: KeyRendererPort = {
  render: async (visual: ButtonVisual) => Buffer.from(visual.label?.text ?? 'blank'),
  renderFrames: async (visual: ButtonVisual): Promise<readonly AnimatedFrame[] | undefined> => {
    if (visual.icon?.source !== 'anim') return undefined;
    return [
      { image: Buffer.from('frame-a'), delayMs: 40 },
      { image: Buffer.from('frame-b'), delayMs: 40 },
    ];
  },
};

function profile(animated: boolean): ProfileDefinition {
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'p',
    name: 'P',
    layout: { rows: 1, cols: 3 },
    root: {
      id: 'root',
      name: 'Root',
      pages: [
        {
          id: 'main',
          /*
             A mix on purpose. With every key animated a repaint writes
             nothing at all — the animation path takes over — so there would be
             nothing for a tick to collide with. The still key is what the
             repaint writes while the others are mid-frame.
           */
          buttons: [0, 1, 2].map((key) => ({
            id: `b${key}`,
            key,
            states: [
              {
                id: 'default',
                visual:
                  animated && key < 2
                    ? { icon: { source: 'anim' }, label: { text: `anim${key}` } }
                    : { label: { text: `still${key}` } },
              },
            ],
          })),
        },
      ],
    },
  };
}

describe('painting a scene that contains animations', () => {
  /**
   * The complaint this answers: one GIF made the whole scene appear late,
   * because the paint loop waited for its frames before moving on.
   */
  it('draws every key before any animation has finished decoding', async () => {
    const surface = new SlowSurface();
    const clock = new Clock();

    let releaseFrames: (() => void) | undefined;
    const slowToDecode: KeyRendererPort = {
      render: renderer.render,
      renderFrames: async (visual: ButtonVisual) => {
        if (visual.icon?.source !== 'anim') return undefined;
        await new Promise<void>((resolve) => {
          releaseFrames = resolve;
        });
        return [
          { image: Buffer.from('frame-a'), delayMs: 40 },
          { image: Buffer.from('frame-b'), delayMs: 40 },
        ];
      },
    };

    const controller = new DeckController(surface, slowToDecode, new ActionRegistry(), { clock });
    controller.load(profile(true));
    await controller.start();

    // Decoding has not returned yet, and the panel is already complete.
    const drawn = new Set(
      surface.log
        .filter((entry) => entry.startsWith('end'))
        .map((entry) => Number(/^end {3}(\d+):/.exec(entry)![1])),
    );
    assert.deepEqual([...drawn].sort(), [0, 1, 2], `only drew: ${surface.log.join(', ')}`);

    releaseFrames?.();
  });
});

describe('writes to the panel are serialized', () => {
  /**
   * The bug this guards: animation ticks used to run on their own promise
   * chain. A tick already awaiting a write resumed *after* a repaint had
   * replaced the key, put its stale frame back, and left the key wrong for
   * good — the repaint had already recorded it as up to date.
   */
  it('never interleaves an animation tick with a repaint', async () => {
    const surface = new SlowSurface();
    const clock = new Clock();
    const controller = new DeckController(surface, renderer, new ActionRegistry(), { clock });

    controller.load(profile(true));
    await controller.start();

    surface.log.length = 0;

    /*
     * A tick begins, and a repaint is requested before it finishes — no
     * profile reload involved, so the animations are still live and the two
     * really do overlap. This is the shape of every case: something changes
     * while a key is mid-write.
     */
    clock.time = 100;
    clock.fire();
    controller.invalidate();

    await new Promise((resolve) => setTimeout(resolve, 30));

    // Every write must finish before the next begins. Anything else means two
    // chains were touching the panel at once.
    for (let index = 0; index < surface.log.length; index += 2) {
      const started = surface.log[index]!;
      const ended = surface.log[index + 1];
      assert.ok(started.startsWith('start') || started.startsWith('clear'), surface.log.join('\n'));
      if (started.startsWith('start')) {
        assert.equal(
          ended,
          started.replace('start', 'end  '),
          `write was interrupted:\n${surface.log.join('\n')}`,
        );
      } else {
        index -= 1;
      }
    }
  });

  it('leaves no key showing an animation frame once the animation is gone', async () => {
    const surface = new SlowSurface();
    const clock = new Clock();
    const controller = new DeckController(surface, renderer, new ActionRegistry(), { clock });

    controller.load(profile(true));
    await controller.start();

    controller.load(profile(false));
    // What a profile reload actually does; `start` is a no-op once running.
    controller.invalidate();
    clock.time = 500;
    clock.fire();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const lastPerKey = new Map<number, string>();
    for (const entry of surface.log) {
      const match = /^end {3}(\d+):(.+)$/.exec(entry);
      if (match) lastPerKey.set(Number(match[1]), match[2]!);
    }

    for (const [key, what] of lastPerKey) {
      assert.equal(what, `still${key}`, `key ${key} was left showing ${what}`);
    }
  });
});
