import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const played: string[] = [];

  // A real pair of folders, thrown away afterwards: the settings tests write,
  // and writing into the user's own configuration to check a beep would be a
  // poor trade.
  const dir = await mkdtemp(join(tmpdir(), 'easydeck-clock-'));

  const variables = new VariableStore();
  const runtime = new PluginRuntime({
    settings: new PluginSettingsStore(undefined, join(dir, 'open'), join(dir, 'sealed')),
    variables,
  });

  const registry = createActionRegistry();
  const plugin = await registerClockPlugin(registry, runtime, () => now, (alias) => {
    played.push(alias);
  });

  return {
    registry,
    played,
    /** Fills in the plugin's settings the way the settings window would. */
    configure: (values: Record<string, string | number | boolean>) =>
      runtime.configure(CLOCK_PLUGIN_ID, values),
    /** Moves the clock on without waiting for it. */
    travel: (seconds: number) => {
      now += seconds * 1000;
    },
    /** The beat the host would have delivered, delivered by hand. */
    tick: () => plugin.tick(),
    watch: (...keys: string[]) => runtime.setWatched(keys),
    /** The list a configurator would put behind a field. */
    options: (name: string) => runtime.optionsFor(CLOCK_PLUGIN_ID, name),
    run: (type: string, params: Record<string, unknown> = {}) =>
      registry.run({ type, params }, context()),
    value: (name: string) => variables.snapshot()[name],
    dispose: () => rm(dir, { recursive: true, force: true }),
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

describe('timers somebody named', () => {
  const KEYS = (name: string) => [
    `clock.timer(${name})`,
    `clock.timer-seconds(${name})`,
    `clock.timer-running(${name})`,
  ];

  it('comes into existence by being named, and counts down from what it was given', async () => {
    const clock = await bench();
    clock.watch(...KEYS('Кофе'));

    // There is no list of timers anywhere else; this is what creates one.
    await clock.run('clock.start-timer', { name: 'Кофе', minutes: 3, seconds: 30 });
    assert.equal(clock.value('clock.timer(Кофе)'), '3:30');
    assert.equal(clock.value('clock.timer-running(Кофе)'), true);

    clock.travel(90);
    clock.tick();
    assert.equal(clock.value('clock.timer(Кофе)'), '2:00');
    assert.equal(clock.value('clock.timer-seconds(Кофе)'), 120);

    await clock.dispose();
  });

  it('counts up instead when it was given no length', async () => {
    // The difference between a stopwatch and a countdown, and the only one.
    const clock = await bench();
    clock.watch(...KEYS('Стрим'));

    await clock.run('clock.start-timer', { name: 'Стрим' });
    clock.travel(75);
    clock.tick();

    assert.equal(clock.value('clock.timer(Стрим)'), '1:15');
    assert.equal(clock.value('clock.timer-seconds(Стрим)'), 75);

    await clock.dispose();
  });

  it('is one timer per name, and two names are two timers', async () => {
    const clock = await bench();
    clock.watch(...KEYS('Кофе'), ...KEYS('Чай'));

    await clock.run('clock.start-timer', { name: 'Кофе', minutes: 5 });
    clock.travel(60);
    await clock.run('clock.start-timer', { name: 'Чай', minutes: 2 });
    clock.travel(30);
    clock.tick();

    assert.equal(clock.value('clock.timer(Кофе)'), '3:30');
    assert.equal(clock.value('clock.timer(Чай)'), '1:30');

    // The same name is the same timer, which is how a start key and a display
    // key on the other side of the profile are about one thing.
    await clock.run('clock.timer', { name: 'Кофе', do: 'stop' });
    assert.equal(clock.value('clock.timer-running(Кофе)'), false);
    assert.equal(clock.value('clock.timer-running(Чай)'), true);

    await clock.dispose();
  });

  it('offers what is running, and nothing before anything is', async () => {
    const clock = await bench();

    // What the fields behind "pause" and `clock.timer(…)` are filled from.
    assert.deepEqual(await clock.options('timers'), []);

    await clock.run('clock.start-timer', { name: 'Чай', minutes: 2 });
    await clock.run('clock.start-timer', { name: 'Кофе', minutes: 5 });

    assert.deepEqual(
      (await clock.options('timers')).map((option) => option.value),
      ['Кофе', 'Чай'],
    );

    await clock.dispose();
  });

  it('is gone from the list and off the keys once it is deleted', async () => {
    // The way out of a typo, which is what a name typed by hand makes instead
    // of an error.
    const clock = await bench();
    clock.watch(...KEYS('Кофн'));

    await clock.run('clock.start-timer', { name: 'Кофн', minutes: 5 });
    assert.equal(clock.value('clock.timer(Кофн)'), '5:00');

    await clock.run('clock.timer', { name: 'Кофн', do: 'forget' });

    assert.deepEqual(await clock.options('timers'), []);
    assert.equal(clock.value('clock.timer(Кофн)'), undefined);
    assert.equal(clock.value('clock.timer-running(Кофн)'), undefined);

    await clock.dispose();
  });

  it('does nothing, quietly, about a timer that is not there', async () => {
    /*
     * Timers do not outlive the daemon but the profile does, so every "pause
     * the coffee timer" key spends the time before its timer is started
     * pointing at nothing. That is the ordinary state of affairs rather than a
     * mistake worth marking a key for.
     */
    const clock = await bench();
    await clock.run('clock.timer', { name: 'Кофе', do: 'stop' });

    assert.deepEqual(await clock.options('timers'), []);
    await clock.dispose();
  });

  it('refuses to make one with no name', async () => {
    // The other side of the same coin: a key that could never do anything,
    // where the warning on it is the only way anybody would find out.
    const clock = await bench();

    await assert.rejects(() => clock.run('clock.start-timer', { name: '  ' }));
    await clock.dispose();
  });

  it('lands on zero, stops itself, and says so', async () => {
    const clock = await bench();
    clock.watch(...KEYS('Пауза'));

    await clock.run('clock.start-timer', { name: 'Пауза', minutes: 0, seconds: 20 });
    clock.travel(20);
    clock.tick();

    assert.equal(clock.value('clock.timer-seconds(Пауза)'), 0);
    assert.equal(clock.value('clock.timer-running(Пауза)'), false);

    // And stays there rather than going negative or starting over.
    clock.travel(600);
    clock.tick();
    assert.equal(clock.value('clock.timer-seconds(Пауза)'), 0);

    await clock.dispose();
  });

  it('makes the countdown noise when a named one arrives', async () => {
    const clock = await bench();

    await clock.run('clock.start-timer', { name: 'Кофе', minutes: 0, seconds: 10 });
    clock.travel(10);
    clock.tick();

    assert.deepEqual(clock.played, ['Notification.Reminder']);

    // Once, not every beat afterwards.
    clock.travel(30);
    clock.tick();
    assert.equal(clock.played.length, 1);

    await clock.dispose();
  });

  it('publishes nothing for a timer no key is showing', async () => {
    // The whole reason these are a family: a profile may name a dozen and a
    // page shows one.
    const clock = await bench();
    clock.watch('clock.timer(Кофе)');

    await clock.run('clock.start-timer', { name: 'Кофе', minutes: 5 });
    await clock.run('clock.start-timer', { name: 'Чай', minutes: 5 });

    assert.equal(clock.value('clock.timer(Кофе)'), '5:00');
    assert.equal(clock.value('clock.timer(Чай)'), undefined);
    assert.equal(clock.value('clock.timer-seconds(Кофе)'), undefined);

    await clock.dispose();
  });
});

describe('the noise a finished timer makes', () => {
  it('sounds when the countdown arrives, and once', async () => {
    const clock = await bench();

    await clock.run('clock.countdown', { do: 'restart', minutes: 0, seconds: 10 });
    assert.deepEqual(clock.played, [], 'nothing yet');

    clock.travel(10);
    clock.tick();
    assert.deepEqual(clock.played, ['Notification.Reminder']);

    // Every beat afterwards finds a countdown that is already finished.
    clock.travel(60);
    clock.tick();
    clock.tick();
    assert.equal(clock.played.length, 1);

    await clock.dispose();
  });

  it('sounds when a pomodoro phase runs out by itself', async () => {
    const clock = await bench();

    await clock.run('clock.pomodoro', { do: 'start' });
    clock.travel(25 * 60);
    clock.tick();

    assert.deepEqual(clock.played, ['Notification.Default']);
    await clock.dispose();
  });

  it('says nothing when the phase was changed by hand', async () => {
    // Somebody who pressed "skip" watched themselves do it. Same for starting
    // and clearing, which also move the phase.
    const clock = await bench();

    await clock.run('clock.pomodoro', { do: 'start' });
    await clock.run('clock.pomodoro', { do: 'skip' });
    await clock.run('clock.pomodoro', { do: 'reset' });

    assert.deepEqual(clock.played, []);
    await clock.dispose();
  });

  it('makes one noise for two phases missed while it was quiet', async () => {
    const clock = await bench();

    await clock.run('clock.pomodoro', { do: 'start' });
    // Work and the break both gone by; it comes back inside the second work.
    clock.travel(25 * 60 + 5 * 60 + 60);
    clock.tick();

    assert.deepEqual(clock.played, ['Notification.Default']);
    await clock.dispose();
  });

  it('is silent for somebody who chose silence', async () => {
    const clock = await bench();
    await clock.configure({ countdownSound: '', pomodoroSound: '' });

    await clock.run('clock.countdown', { do: 'restart', minutes: 0, seconds: 5 });
    clock.travel(5);
    clock.tick();

    assert.deepEqual(clock.played, []);
    await clock.dispose();
  });

  it('plays what was chosen instead of what it shipped with', async () => {
    const clock = await bench();
    await clock.configure({ countdownSound: 'Notification.Looping.Alarm' });

    await clock.run('clock.countdown', { do: 'restart', minutes: 0, seconds: 5 });
    clock.travel(5);
    clock.tick();

    assert.deepEqual(clock.played, ['Notification.Looping.Alarm']);
    await clock.dispose();
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
