import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { VariableStore, createActionRegistry } from '@easydeck/engine';

import { PluginRuntime } from '../../../application/plugin-runtime.js';
import { PluginSettingsStore } from '../plugin-settings-store.js';
import { CLOCK_PLUGIN_ID, registerClockPlugin } from './clock-plugin.js';

/**
 * The clock through a real runtime and a real registry, with only the wall
 * clock replaced. What is worth being wrong about here is the arrangement
 * between the plugin, what is being watched, and what a key receives — none of
 * which the pure timekeeping tests next door can see.
 */
async function bench(startingAt = Date.parse('2026-08-12T09:41:07Z')) {
  let now = startingAt;

  const variables = new VariableStore();
  const runtime = new PluginRuntime({
    // Paths that do not exist: the clock reads settings and writes none, so a
    // stray write would land somewhere harmless rather than in the user's own
    // configuration.
    settings: new PluginSettingsStore(undefined, '/nonexistent/open', '/nonexistent/sealed'),
    variables,
  });

  const registry = createActionRegistry();
  const plugin = await registerClockPlugin(registry, runtime, () => now);

  return {
    registry,
    /** Moves the clock on without waiting for it. */
    travel: (seconds: number) => {
      now += seconds * 1000;
    },
    /** The beat the host would have delivered, delivered by hand. */
    tick: () => plugin.tick(),
    watch: (...keys: string[]) => runtime.setWatched(keys),
    run: (type: string, params: Record<string, unknown> = {}) =>
      registry.run({ type, params }, context()),
    value: (name: string) => variables.snapshot()[name],
  };
}

function context() {
  return {
    variables: new VariableStore(),
    deckId: 'test',
    button: { id: 'b', key: 0 },
    location: { folderId: 'root', pageId: 'page' },
    profileId: 'p',
    openFolder: () => undefined,
    goToPage: () => undefined,
    goUp: () => undefined,
    goHome: () => undefined,
    goBack: () => undefined,
    setState: () => undefined,
  } as never;
}

describe('a clock nobody is looking at', () => {
  it('publishes nothing at all', async () => {
    const clock = await bench();
    clock.tick();

    // The reason this plugin is the reference one: a value that changes every
    // second, written when nothing reads it, is a repaint and a picture down
    // the USB cable every second, for nobody.
    assert.equal(clock.value('clock.time'), undefined);
    assert.equal(clock.value('clock.seconds'), undefined);
  });

  it('fills in the moment a key asks for it', async () => {
    const clock = await bench();
    clock.watch('clock.time');

    // No tick in between: being watched is itself the thing that publishes.
    assert.match(String(clock.value('clock.time')), /^\d{2}:\d{2}$/);
    // And still nothing for the one nobody asked for.
    assert.equal(clock.value('clock.seconds'), undefined);
  });
});

describe('the stopwatch', () => {
  it('starts, counts and pauses where it stands', async () => {
    const clock = await bench();
    clock.watch('clock.stopwatch', 'clock.stopwatch-seconds', 'clock.stopwatch-running');

    await clock.run('clock.stopwatch', { do: 'start' });
    assert.equal(clock.value('clock.stopwatch'), '0:00');
    assert.equal(clock.value('clock.stopwatch-running'), true);

    clock.travel(75);
    await clock.run('clock.stopwatch', { do: 'stop' });

    assert.equal(clock.value('clock.stopwatch'), '1:15');
    assert.equal(clock.value('clock.stopwatch-seconds'), 75);
    assert.equal(clock.value('clock.stopwatch-running'), false);

    // Paused means paused: the clock moving on does not move it.
    clock.travel(600);
    clock.tick();
    assert.equal(clock.value('clock.stopwatch'), '1:15');
  });

  it('carries on from where it was paused', async () => {
    const clock = await bench();
    clock.watch('clock.stopwatch');

    await clock.run('clock.stopwatch', { do: 'start' });
    clock.travel(10);
    await clock.run('clock.stopwatch', { do: 'toggle' });
    clock.travel(300);
    await clock.run('clock.stopwatch', { do: 'toggle' });
    clock.travel(5);
    await clock.run('clock.stopwatch', { do: 'stop' });

    assert.equal(clock.value('clock.stopwatch'), '0:15');
  });
});

describe('the countdown', () => {
  it('takes its length from the key that started it', async () => {
    const clock = await bench();
    clock.watch('clock.countdown');

    await clock.run('clock.countdown', { do: 'restart', minutes: 2, seconds: 30 });
    assert.equal(clock.value('clock.countdown'), '2:30');

    clock.travel(90);
    clock.tick();
    assert.equal(clock.value('clock.countdown'), '1:00');
  });

  /*
   * The one the roadmap wanted answered: a countdown arriving has to be
   * something a handler can act on. It is, twice over — the number stops at
   * exactly zero and stays there, and the running flag turns over. Both are
   * edges, so a handler fires once rather than every second afterwards.
   */
  it('lands on zero, stops itself, and stays there', async () => {
    const clock = await bench();
    clock.watch('clock.countdown-seconds', 'clock.countdown-running');

    await clock.run('clock.countdown', { do: 'restart', minutes: 0, seconds: 30 });
    assert.equal(clock.value('clock.countdown-running'), true);

    clock.travel(30);
    clock.tick();

    assert.equal(clock.value('clock.countdown-seconds'), 0);
    assert.equal(clock.value('clock.countdown-running'), false);

    clock.travel(3600);
    clock.tick();
    assert.equal(clock.value('clock.countdown-seconds'), 0);
  });

  it('does not silently lengthen one that was only paused', async () => {
    const clock = await bench();
    clock.watch('clock.countdown');

    await clock.run('clock.countdown', { do: 'restart', minutes: 1, seconds: 0 });
    clock.travel(20);
    await clock.run('clock.countdown', { do: 'stop' });
    assert.equal(clock.value('clock.countdown'), '0:40');

    // Resuming carries the duration it already had, whatever this key says.
    await clock.run('clock.countdown', { do: 'start', minutes: 9, seconds: 0 });
    clock.travel(10);
    clock.tick();
    assert.equal(clock.value('clock.countdown'), '0:30');
  });
});

describe('the pomodoro', () => {
  it('turns work into a break by itself', async () => {
    const clock = await bench();
    clock.watch('clock.pomodoro', 'clock.pomodoro-phase', 'clock.pomodoro-round');

    await clock.run('clock.pomodoro', { do: 'start' });
    assert.equal(clock.value('clock.pomodoro-phase'), 'work');
    assert.equal(clock.value('clock.pomodoro'), '25:00');

    // Straight through the work and a minute into the break.
    clock.travel(25 * 60 + 60);
    clock.tick();

    assert.equal(clock.value('clock.pomodoro-phase'), 'rest');
    assert.equal(clock.value('clock.pomodoro'), '4:00');
    assert.equal(clock.value('clock.pomodoro-round'), 1);
  });

  it('skips to the next phase on request', async () => {
    const clock = await bench();
    clock.watch('clock.pomodoro-phase', 'clock.pomodoro');

    await clock.run('clock.pomodoro', { do: 'start' });
    await clock.run('clock.pomodoro', { do: 'skip' });

    assert.equal(clock.value('clock.pomodoro-phase'), 'rest');
    assert.equal(clock.value('clock.pomodoro'), '5:00');
  });

  it('goes back to the first work of a new set when cleared', async () => {
    const clock = await bench();
    clock.watch('clock.pomodoro-phase', 'clock.pomodoro-round', 'clock.pomodoro-running');

    await clock.run('clock.pomodoro', { do: 'start' });
    await clock.run('clock.pomodoro', { do: 'skip' });
    await clock.run('clock.pomodoro', { do: 'reset' });

    assert.equal(clock.value('clock.pomodoro-phase'), 'work');
    assert.equal(clock.value('clock.pomodoro-round'), 1);
    assert.equal(clock.value('clock.pomodoro-running'), false);
  });
});

describe('what the plugin offers', () => {
  it('declares every variable its presets read', async () => {
    const clock = await bench();
    const manifest = clock.registry.plugins().find((each) => each.id === CLOCK_PLUGIN_ID);
    assert.ok(manifest);

    const declared = new Set((manifest.variables ?? []).map((variable) => variable.name));
    const text = JSON.stringify(manifest.presets ?? []);

    // A preset naming a variable the manifest forgot puts a key on the grid
    // that shows an empty space for ever, and says nothing about why.
    for (const match of text.matchAll(/\{\{([\w.-]+)\}\}/g)) {
      const name = match[1] ?? '';
      assert.ok(declared.has(name), `preset reads undeclared ${name}`);
    }
  });

  it('binds its preset states to variables it declares', async () => {
    const clock = await bench();
    const manifest = clock.registry.plugins().find((each) => each.id === CLOCK_PLUGIN_ID);
    const declared = new Set((manifest?.variables ?? []).map((variable) => variable.name));

    for (const preset of manifest?.presets ?? []) {
      const from: string | undefined = preset.button.stateFrom;
      if (from === undefined) continue;
      assert.ok(declared.has(from), `preset '${preset.name}' binds to undeclared ${from}`);
    }
  });
});
