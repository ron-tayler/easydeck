import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { VariableStore, createActionRegistry, parseVariableKey } from '@easydeck/engine';

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
    registry,
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

describe('a stopwatch', () => {
  const KEYS = ['clock.stopwatch(Секундомер)', 'clock.stopwatch-seconds(Секундомер)', 'clock.stopwatch-running(Секундомер)'];
  const press = (what: string) => ({ name: 'Секундомер', do: what });

  it('starts, counts and pauses where it stands', async () => {
    const clock = await bench();
    clock.watch(...KEYS);

    await clock.run('clock.stopwatch', press('start'));
    assert.equal(clock.value('clock.stopwatch(Секундомер)'), '0:00');
    assert.equal(clock.value('clock.stopwatch-running(Секундомер)'), true);

    clock.travel(75);
    await clock.run('clock.stopwatch', press('stop'));

    assert.equal(clock.value('clock.stopwatch(Секундомер)'), '1:15');
    assert.equal(clock.value('clock.stopwatch-seconds(Секундомер)'), 75);
    assert.equal(clock.value('clock.stopwatch-running(Секундомер)'), false);

    // Paused means paused: the clock moving on does not move it.
    clock.travel(600);
    clock.tick();
    assert.equal(clock.value('clock.stopwatch(Секундомер)'), '1:15');

    await clock.dispose();
  });

  it('carries on from where it was paused', async () => {
    const clock = await bench();
    clock.watch(...KEYS);

    await clock.run('clock.stopwatch', press('start'));
    clock.travel(10);
    await clock.run('clock.stopwatch', press('toggle'));
    clock.travel(300);
    await clock.run('clock.stopwatch', press('toggle'));
    clock.travel(5);
    await clock.run('clock.stopwatch', press('stop'));

    assert.equal(clock.value('clock.stopwatch(Секундомер)'), '0:15');
    await clock.dispose();
  });

  it('goes back to nothing when it is cleared', async () => {
    // The action a hold gets, beside the press that starts it. It asks for a
    // name and nothing else, because clearing has no length to it.
    const clock = await bench();
    clock.watch(...KEYS);

    await clock.run('clock.stopwatch', press('start'));
    clock.travel(42);
    await clock.run('clock.stopwatch-reset', { name: 'Секундомер' });

    assert.equal(clock.value('clock.stopwatch(Секундомер)'), '0:00');
    assert.equal(clock.value('clock.stopwatch-running(Секундомер)'), false);

    await clock.dispose();
  });
});

describe('a timer', () => {
  const KEYS = ['clock.timer(Таймер)', 'clock.timer-seconds(Таймер)', 'clock.timer-running(Таймер)'];
  const press = (what: string, minutes = 5, seconds = 0) => ({
    name: 'Таймер',
    do: what,
    minutes,
    seconds,
  });

  it('takes its length from the key that started it', async () => {
    const clock = await bench();
    clock.watch(...KEYS);

    await clock.run('clock.timer', press('restart', 2, 30));
    assert.equal(clock.value('clock.timer(Таймер)'), '2:30');

    clock.travel(90);
    clock.tick();
    assert.equal(clock.value('clock.timer(Таймер)'), '1:00');

    await clock.dispose();
  });

  /*
   * The one the roadmap wanted answered: a timer arriving has to be something
   * a handler can act on. It is, twice over — the number stops at exactly zero
   * and stays there, and the running flag turns over. Both are edges, so a
   * handler fires once rather than every second afterwards.
   */
  it('lands on zero, stops itself, and stays there', async () => {
    const clock = await bench();
    clock.watch(...KEYS);

    await clock.run('clock.timer', press('restart', 0, 30));
    assert.equal(clock.value('clock.timer-running(Таймер)'), true);

    clock.travel(30);
    clock.tick();

    assert.equal(clock.value('clock.timer-seconds(Таймер)'), 0);
    assert.equal(clock.value('clock.timer-running(Таймер)'), false);

    clock.travel(3600);
    clock.tick();
    assert.equal(clock.value('clock.timer-seconds(Таймер)'), 0);

    await clock.dispose();
  });

  it('starts, pauses and resumes from one key pressed three times', async () => {
    /*
     * What the whole shape is for. One binding, no conditions: the first press
     * starts it at the length the key names, the second pauses it where it
     * stands, the third carries on from there — and the length on the key is
     * pointedly *not* taken again, or resuming would silently lengthen it.
     */
    const clock = await bench();
    clock.watch(...KEYS);

    await clock.run('clock.timer', press('toggle', 1, 0));
    assert.equal(clock.value('clock.timer-running(Таймер)'), true);

    clock.travel(20);
    await clock.run('clock.timer', press('toggle', 1, 0));
    assert.equal(clock.value('clock.timer(Таймер)'), '0:40');
    assert.equal(clock.value('clock.timer-running(Таймер)'), false);

    clock.travel(300);
    await clock.run('clock.timer', press('toggle', 9, 0));
    clock.travel(10);
    clock.tick();

    assert.equal(clock.value('clock.timer(Таймер)'), '0:30', 'not nine minutes');
    await clock.dispose();
  });

  it('is cleared by its own action, which asks for no length', async () => {
    // What a hold gets, beside the press that starts it: back to the full
    // length it was last given, and stopped.
    const clock = await bench();
    clock.watch(...KEYS);

    await clock.run('clock.timer', press('toggle', 2, 0));
    clock.travel(30);
    await clock.run('clock.timer-reset', { name: 'Таймер' });

    assert.equal(clock.value('clock.timer(Таймер)'), '2:00');
    assert.equal(clock.value('clock.timer-running(Таймер)'), false);

    // And pressing again starts that same length over.
    await clock.run('clock.timer', press('toggle', 2, 0));
    assert.equal(clock.value('clock.timer-running(Таймер)'), true);

    await clock.dispose();
  });
});

describe('which timers exist', () => {
  it('is the settings list, and a fresh install has one of each', async () => {
    const clock = await bench();

    assert.deepEqual(
      (await clock.options('timers')).map((option) => option.value),
      ['Таймер'],
    );
    assert.deepEqual(
      (await clock.options('stopwatches')).map((option) => option.value),
      ['Секундомер'],
    );

    await clock.dispose();
  });

  it('follows what the settings say, and one added starts idle', async () => {
    const clock = await bench();
    await clock.configure({ timers: 'Кофе\nЧай' });

    assert.deepEqual(
      (await clock.options('timers')).map((option) => option.value),
      ['Кофе', 'Чай'],
    );

    clock.watch('clock.timer(Кофе)', 'clock.timer-running(Кофе)');
    clock.tick();
    assert.equal(clock.value('clock.timer-running(Кофе)'), false);

    await clock.dispose();
  });

  it('takes a removed one off the keys rather than freezing it there', async () => {
    /*
     * A key still showing `2:14` for a timer nobody can reach any more is a key
     * lying about the present. Renaming is this and an add together, which is
     * the honest reading of it.
     */
    const clock = await bench();
    await clock.configure({ timers: 'Кофе' });
    clock.watch('clock.timer(Кофе)', 'clock.timer-running(Кофе)');

    await clock.run('clock.timer', { name: 'Кофе', do: 'toggle', minutes: 5, seconds: 0 });
    assert.equal(clock.value('clock.timer(Кофе)'), '5:00');

    await clock.configure({ timers: 'Чай' });

    assert.equal(clock.value('clock.timer(Кофе)'), undefined);
    assert.equal(clock.value('clock.timer-running(Кофе)'), undefined);

    await clock.dispose();
  });

  it('does nothing, quietly, about a name that is not in the list', async () => {
    // A profile outlives a settings edit, so a key can name a timer somebody
    // has since deleted. That is worth no fuss on the key.
    const clock = await bench();
    clock.watch('clock.timer(Призрак)');

    await clock.run('clock.timer', { name: 'Призрак', do: 'toggle', minutes: 1, seconds: 0 });
    assert.equal(clock.value('clock.timer(Призрак)'), undefined);

    await clock.dispose();
  });

  it('is one timer per name, and two names are two timers', async () => {
    const clock = await bench();
    await clock.configure({ timers: 'Кофе\nЧай' });
    clock.watch(
      'clock.timer(Кофе)',
      'clock.timer-running(Кофе)',
      'clock.timer(Чай)',
      'clock.timer-running(Чай)',
    );

    await clock.run('clock.timer', { name: 'Кофе', do: 'toggle', minutes: 5, seconds: 0 });
    clock.travel(60);
    await clock.run('clock.timer', { name: 'Чай', do: 'toggle', minutes: 2, seconds: 0 });
    clock.travel(30);
    clock.tick();

    assert.equal(clock.value('clock.timer(Кофе)'), '3:30');
    assert.equal(clock.value('clock.timer(Чай)'), '1:30');

    // The same name is the same timer, which is how a start key and a display
    // key on the other side of the profile are about one thing.
    await clock.run('clock.timer', { name: 'Кофе', do: 'stop', minutes: 5, seconds: 0 });
    assert.equal(clock.value('clock.timer-running(Кофе)'), false);
    assert.equal(clock.value('clock.timer-running(Чай)'), true);

    await clock.dispose();
  });

  it('publishes nothing for one no key is showing', async () => {
    // The whole reason these are a family: a profile may name a dozen and a
    // page shows one.
    const clock = await bench();
    await clock.configure({ timers: 'Кофе\nЧай' });
    clock.watch('clock.timer(Кофе)');

    await clock.run('clock.timer', { name: 'Кофе', do: 'toggle', minutes: 5, seconds: 0 });
    await clock.run('clock.timer', { name: 'Чай', do: 'toggle', minutes: 5, seconds: 0 });

    assert.equal(clock.value('clock.timer(Кофе)'), '5:00');
    assert.equal(clock.value('clock.timer(Чай)'), undefined);
    assert.equal(clock.value('clock.timer-seconds(Кофе)'), undefined);

    await clock.dispose();
  });

  it('drops a blank row and a name typed twice', async () => {
    // Both are what a list somebody is editing looks like mid-edit; neither is
    // a timer.
    const clock = await bench();
    await clock.configure({ timers: 'Кофе\n\n  \nКофе\nЧай' });

    assert.deepEqual(
      (await clock.options('timers')).map((option) => option.value),
      ['Кофе', 'Чай'],
    );

    await clock.dispose();
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


describe('the noise a finished timer makes', () => {
  it('sounds when the countdown arrives, and once', async () => {
    const clock = await bench();

    await clock.run('clock.timer', { name: 'Таймер', do: 'restart', minutes: 0, seconds: 10 });
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

    await clock.run('clock.timer', { name: 'Таймер', do: 'restart', minutes: 0, seconds: 5 });
    clock.travel(5);
    clock.tick();

    assert.deepEqual(clock.played, []);
    await clock.dispose();
  });

  it('plays what was chosen instead of what it shipped with', async () => {
    const clock = await bench();
    await clock.configure({ countdownSound: 'Notification.Looping.Alarm' });

    await clock.run('clock.timer', { name: 'Таймер', do: 'restart', minutes: 0, seconds: 5 });
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
    // that shows an empty space for ever, and says nothing about why. Compared
    // by family, because a key naming one of a family carries its argument:
    // `clock.timer(Таймер)` is declared once, as `clock.timer`.
    for (const match of text.matchAll(/\{\{([^}]+)\}\}/g)) {
      const name = parseVariableKey(match[1] ?? '').family;
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

      const family = parseVariableKey(from).family;
      assert.ok(declared.has(family), `preset '${preset.name}' binds to undeclared ${family}`);
    }
  });

  it('points its presets at names the settings actually ship with', async () => {
    /*
     * The other half of the same worry. A preset naming a family is declared,
     * and still a dead key if the argument it names is not in the list a fresh
     * install has — which is the one thing the check above cannot see.
     */
    const clock = await bench();
    const manifest = clock.registry.plugins().find((each) => each.id === CLOCK_PLUGIN_ID);
    const text = JSON.stringify(manifest?.presets ?? []);

    const lists: Record<string, readonly string[]> = {
      'clock.timer': (await clock.options('timers')).map((option) => option.value),
      'clock.stopwatch': (await clock.options('stopwatches')).map((option) => option.value),
    };

    for (const match of text.matchAll(/\{\{([^}]+)\}\}/g)) {
      const { family, argument } = parseVariableKey(match[1] ?? '');
      const base = family.replace(/-(seconds|running)$/, '');
      const expected = lists[base];
      if (!expected || argument === undefined) continue;

      assert.ok(expected.includes(argument), `preset names '${argument}', which is not in the list`);
    }

    await clock.dispose();
  });
});
