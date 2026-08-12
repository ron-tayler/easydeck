import { PLUGIN_API_VERSION, numberParam } from '@easydeck/engine';
import type {
  ActionRegistry,
  Plugin,
  PluginHost,
  PluginManifest,
  Ticker,
  VariableValue,
} from '@easydeck/engine';

import type { PluginRuntime } from '../../../application/plugin-runtime.js';
import {
  FRESH,
  IDLE,
  advance,
  elapsed,
  formatSpan,
  pause,
  remaining,
  remainingInPhase,
  reset,
  restart,
  skipPhase,
  start,
  toggle,
} from './timekeeping.js';
import type { Plan, Pomodoro, Span } from './timekeeping.js';

/**
 * The time, and the three timers a desk actually wants.
 *
 * The smallest plugin here, and deliberately so: nothing to install, nothing
 * to authorise, nothing that can be closed while the deck is running. It is
 * the one to read before writing your own.
 *
 * What it does that none of the others do is change a variable *on its own
 * schedule* rather than because something outside changed. That makes
 * `onWatched` a matter of correctness instead of thrift: a clock ticking for a
 * page nobody has open is a picture pushed down the USB cable every second,
 * for nothing. So the beat is set by what is being read — a second while
 * something wants seconds, a minute while something wants the time, and
 * nothing at all while nobody is looking.
 *
 * The timers themselves keep running regardless. They are instants, not
 * counters (see timekeeping.ts), so going quiet costs nothing and coming back
 * needs no catching up.
 */

export const CLOCK_PLUGIN_ID = 'clock';

/** Read once a minute; the rest of the day they are the same string. */
const PER_MINUTE = ['clock.time', 'clock.date', 'clock.weekday'] as const;

const DEFAULT_COUNTDOWN = 5 * 60;

const DOING = [
  { value: 'toggle', label: { en: 'Start or pause', ru: 'Пустить или остановить' } },
  { value: 'start', label: { en: 'Start', ru: 'Пустить' } },
  { value: 'stop', label: { en: 'Pause', ru: 'Остановить' } },
  { value: 'restart', label: { en: 'Start again from zero', ru: 'Начать заново с нуля' } },
  { value: 'reset', label: { en: 'Clear', ru: 'Сбросить' } },
];

export const clockManifest: PluginManifest = {
  id: CLOCK_PLUGIN_ID,
  name: { en: 'Clock', ru: 'Часы' },
  description: {
    en: 'The time and date, a stopwatch, a countdown and a pomodoro',
    ru: 'Время и дата, секундомер, обратный отсчёт и помодоро',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,

  settings: [
    {
      name: 'hour12',
      type: 'boolean',
      label: { en: '12-hour clock', ru: '12-часовой формат' },
      default: false,
      required: false,
    },
    {
      name: 'locale',
      type: 'string',
      label: { en: 'Language for dates', ru: 'Язык дат' },
      required: false,
      description: {
        en: "Leave empty to follow the system. A tag like 'ru-RU' or 'en-GB' otherwise",
        ru: 'Оставьте пустым, чтобы взять системный. Иначе — метка вида «ru-RU» или «en-GB»',
      },
    },
    {
      name: 'work',
      type: 'number',
      label: { en: 'Pomodoro: work, minutes', ru: 'Помодоро: работа, минут' },
      default: 25,
      min: 1,
      max: 180,
    },
    {
      name: 'rest',
      type: 'number',
      label: { en: 'Pomodoro: break, minutes', ru: 'Помодоро: перерыв, минут' },
      default: 5,
      min: 1,
      max: 180,
    },
    {
      name: 'longRest',
      type: 'number',
      label: { en: 'Pomodoro: long break, minutes', ru: 'Помодоро: длинный перерыв, минут' },
      default: 15,
      min: 1,
      max: 180,
    },
    {
      name: 'rounds',
      type: 'number',
      label: { en: 'Pomodoro: works before the long break', ru: 'Помодоро: работ до длинного перерыва' },
      default: 4,
      min: 1,
      max: 12,
    },
  ],

  variables: [
    { name: 'clock.time', type: 'string', label: { en: 'Time', ru: 'Время' } },
    {
      name: 'clock.seconds',
      type: 'string',
      label: { en: 'Time with seconds', ru: 'Время с секундами' },
      description: {
        en: 'Separate from the time, because showing it costs a repaint every second',
        ru: 'Отдельно от времени: показ секунд стоит перерисовки раз в секунду',
      },
    },
    { name: 'clock.date', type: 'string', label: { en: 'Date', ru: 'Дата' } },
    { name: 'clock.weekday', type: 'string', label: { en: 'Day of the week', ru: 'День недели' } },

    { name: 'clock.stopwatch', type: 'string', label: { en: 'Stopwatch', ru: 'Секундомер' }, initial: '0:00' },
    {
      name: 'clock.stopwatch-seconds',
      type: 'number',
      label: { en: 'Stopwatch, seconds', ru: 'Секундомер, секунд' },
      description: {
        en: 'The number behind the stopwatch, for a handler to compare against',
        ru: 'Число за секундомером — чтобы обработчик мог его сравнить',
      },
      initial: 0,
    },
    {
      name: 'clock.stopwatch-running',
      type: 'boolean',
      label: { en: 'Stopwatch running', ru: 'Секундомер идёт' },
      initial: false,
    },

    { name: 'clock.countdown', type: 'string', label: { en: 'Countdown', ru: 'Обратный отсчёт' }, initial: '5:00' },
    {
      name: 'clock.countdown-seconds',
      type: 'number',
      label: { en: 'Countdown, seconds left', ru: 'Обратный отсчёт, секунд осталось' },
      description: {
        en: 'Reaches zero and stays there, so a handler waiting for it fires once',
        ru: 'Доходит до нуля и остаётся там — обработчик срабатывает один раз',
      },
      initial: DEFAULT_COUNTDOWN,
    },
    {
      name: 'clock.countdown-running',
      type: 'boolean',
      label: { en: 'Countdown running', ru: 'Обратный отсчёт идёт' },
      initial: false,
    },

    { name: 'clock.pomodoro', type: 'string', label: { en: 'Pomodoro left', ru: 'Помодоро, осталось' }, initial: '25:00' },
    {
      name: 'clock.pomodoro-phase',
      type: 'string',
      label: { en: 'Pomodoro phase', ru: 'Фаза помодоро' },
      description: {
        en: 'work, rest or long-rest — compare against it to know which is on',
        ru: '«work», «rest» или «long-rest» — сравнивайте, чтобы узнать текущую',
      },
      initial: 'work',
    },
    { name: 'clock.pomodoro-round', type: 'number', label: { en: 'Pomodoro round', ru: 'Помодоро, подход' }, initial: 1 },
    {
      name: 'clock.pomodoro-running',
      type: 'boolean',
      label: { en: 'Pomodoro running', ru: 'Помодоро идёт' },
      initial: false,
    },
  ],

  actions: [
    {
      type: 'clock.stopwatch',
      icon: 'clock',
      label: { en: 'Stopwatch', ru: 'Секундомер' },
      params: [
        { name: 'do', type: 'select', label: { en: 'What to do', ru: 'Что сделать' }, default: 'toggle', options: DOING },
      ],
    },
    {
      type: 'clock.countdown',
      icon: 'clock',
      label: { en: 'Countdown', ru: 'Обратный отсчёт' },
      description: {
        en: 'Counts down to zero, where a handler can pick it up',
        ru: 'Считает до нуля — дальше его может подхватить обработчик события',
      },
      params: [
        { name: 'do', type: 'select', label: { en: 'What to do', ru: 'Что сделать' }, default: 'restart', options: DOING },
        {
          name: 'minutes',
          type: 'number',
          label: { en: 'Minutes', ru: 'Минут' },
          default: 5,
          min: 0,
          max: 600,
          description: {
            en: 'Used when it starts from the top; resuming a paused one keeps its own',
            ru: 'Берётся при старте с начала; продолжение остановленного сохраняет своё',
          },
        },
        { name: 'seconds', type: 'number', label: { en: 'Seconds', ru: 'Секунд' }, default: 0, min: 0, max: 59 },
      ],
    },
    {
      type: 'clock.pomodoro',
      icon: 'clock',
      label: { en: 'Pomodoro', ru: 'Помодоро' },
      description: {
        en: 'Work and breaks in turn, to the lengths set in the plugin settings',
        ru: 'Работа и перерывы по очереди, длительности — в настройках плагина',
      },
      params: [
        {
          name: 'do',
          type: 'select',
          label: { en: 'What to do', ru: 'Что сделать' },
          default: 'toggle',
          options: [
            ...DOING,
            { value: 'skip', label: { en: 'Skip to the next phase', ru: 'Перейти к следующей фазе' } },
          ],
        },
      ],
    },
  ],

  presets: [
    {
      name: 'time',
      label: { en: 'Clock', ru: 'Часы' },
      description: { en: 'The time, to the minute', ru: 'Время с точностью до минуты' },
      button: {
        states: [
          {
            id: 'default',
            visual: {
              background: '#1d2733',
              label: { text: '{{clock.time}}', color: '#ffffff', position: 'center', fontSize: 30 },
            },
          },
        ],
      },
    },
    {
      name: 'date',
      label: { en: 'Date', ru: 'Дата' },
      description: { en: 'The day of the week and the date', ru: 'День недели и дата' },
      button: {
        states: [
          {
            id: 'default',
            visual: {
              background: '#1d2733',
              label: { text: '{{clock.weekday}}\n{{clock.date}}', color: '#ffffff', position: 'center', fontSize: 16 },
            },
          },
        ],
      },
    },
    {
      name: 'stopwatch',
      label: { en: 'Stopwatch', ru: 'Секундомер' },
      description: {
        en: 'Press to start and pause; it goes green while it runs',
        ru: 'Нажатие пускает и останавливает; на ходу зеленеет',
      },
      button: {
        stateFrom: 'clock.stopwatch-running',
        states: [
          {
            id: 'stopped',
            when: false,
            visual: {
              background: '#1d2733',
              label: { text: '{{clock.stopwatch}}', color: '#ffffff', position: 'center', fontSize: 24 },
              icon: { source: 'plugin:clock/stopwatch.svg' },
            },
            actions: { press: [{ type: 'clock.stopwatch', params: { do: 'toggle' } }] },
          },
          {
            id: 'running',
            when: true,
            visual: {
              background: '#1f4d33',
              label: { text: '{{clock.stopwatch}}', color: '#ffffff', position: 'center', fontSize: 24 },
            },
          },
        ],
      },
    },
    {
      name: 'countdown',
      label: { en: 'Countdown, 5 minutes', ru: 'Обратный отсчёт, 5 минут' },
      description: {
        en: 'Press to start it again from five minutes',
        ru: 'Нажатие запускает заново с пяти минут',
      },
      button: {
        stateFrom: 'clock.countdown-running',
        states: [
          {
            id: 'idle',
            when: false,
            visual: {
              background: '#1d2733',
              label: { text: '{{clock.countdown}}', color: '#ffffff', position: 'center', fontSize: 24 },
              icon: { source: 'plugin:clock/countdown.svg' },
            },
            actions: {
              press: [{ type: 'clock.countdown', params: { do: 'restart', minutes: 5, seconds: 0 } }],
            },
          },
          {
            id: 'counting',
            when: true,
            visual: {
              background: '#4d3a1f',
              label: { text: '{{clock.countdown}}', color: '#ffffff', position: 'center', fontSize: 24 },
            },
          },
        ],
      },
    },
    {
      name: 'pomodoro',
      label: { en: 'Pomodoro', ru: 'Помодоро' },
      description: {
        en: 'Work and break in turn, coloured by which is on',
        ru: 'Работа и перерыв по очереди, цвет — по текущей фазе',
      },
      button: {
        stateFrom: 'clock.pomodoro-phase',
        states: [
          {
            id: 'work',
            when: 'work',
            visual: {
              background: '#4a2230',
              label: { text: '{{clock.pomodoro}}\n#{{clock.pomodoro-round}}', color: '#ffffff', position: 'center', fontSize: 20 },
              icon: { source: 'plugin:clock/pomodoro.svg' },
            },
            actions: { press: [{ type: 'clock.pomodoro', params: { do: 'toggle' } }] },
          },
          {
            id: 'rest',
            when: 'rest',
            visual: {
              background: '#1f4d33',
              label: { text: '{{clock.pomodoro}}', color: '#ffffff', position: 'center', fontSize: 22 },
            },
          },
          {
            id: 'long-rest',
            when: 'long-rest',
            visual: {
              background: '#1f3a4d',
              label: { text: '{{clock.pomodoro}}', color: '#ffffff', position: 'center', fontSize: 22 },
            },
          },
        ],
      },
    },
  ],
};

export class ClockPlugin implements Plugin {
  private host?: PluginHost;
  private ticker?: Ticker;
  private watched = new Set<string>();

  private stopwatch: Span = IDLE;
  private countdown: Span = IDLE;
  private countdownTotal = DEFAULT_COUNTDOWN;
  private pomodoro: Pomodoro = FRESH;

  /** Injectable so the tests are not at the mercy of the wall clock. */
  constructor(private readonly now: () => number = Date.now) {}

  start(host: PluginHost): void {
    this.host = host;

    host.onWatched((keys) => {
      this.watched = new Set(keys);
      this.tick();
    });

    // Registered stopped. What is worth ticking for depends on what is being
    // read, and at this point nothing has said.
    this.ticker = host.update(0, () => this.tick());

    host.onSettingsChanged(() => this.tick());
    this.tick();
    host.setStatus('ready');
  }

  stop(): void {
    this.ticker?.stop();
    this.ticker = undefined;
    this.host = undefined;
  }

  // --- what a key asked for -------------------------------------------------

  stopwatchAction(what: string): void {
    const now = this.now();
    this.stopwatch = this.applied(this.stopwatch, what, now);
    this.tick();
  }

  countdownAction(what: string, seconds: number): void {
    const now = this.now();
    const fresh = !this.countdown.running && elapsed(this.countdown, now) === 0;

    // The duration on the action is what a countdown starts *from*, so it is
    // taken whenever one begins at the top — and pointedly not when a paused
    // one is resumed, where the key would otherwise silently lengthen it.
    if (what === 'restart' || what === 'reset' || (fresh && (what === 'start' || what === 'toggle'))) {
      this.countdownTotal = Math.max(1, Math.round(seconds));
    }

    this.countdown = this.applied(this.countdown, what, now);
    this.tick();
  }

  pomodoroAction(what: string): void {
    const now = this.now();

    if (what === 'skip') {
      this.pomodoro = skipPhase(advance(this.pomodoro, this.plan(), now), this.plan(), now);
      this.tick();
      return;
    }

    // Rolled forward first: acting on a pomodoro that has been quiet for two
    // phases should act on where it actually is.
    const current = advance(this.pomodoro, this.plan(), now);
    const span = this.applied(current, what, now);

    this.pomodoro =
      what === 'reset' || what === 'restart'
        ? { ...span, phase: 'work', round: 1 }
        : { ...span, phase: current.phase, round: current.round };

    this.tick();
  }

  /** The five verbs every one of these timers shares. */
  private applied(span: Span, what: string, now: number): Span {
    switch (what) {
      case 'start':
        return start(span, now);
      case 'stop':
        return pause(span, now);
      case 'restart':
        return restart(now);
      case 'reset':
        return reset();
      default:
        return toggle(span, now);
    }
  }

  // --- publishing -----------------------------------------------------------

  /**
   * Brings the variables up to date and re-decides how often to do it again.
   *
   * One method for both because they answer each other: whether a second is
   * worth ticking depends on what is running, and what is running is settled
   * here. The host's heartbeat calls it, and so does every action and every
   * change in what is being watched — a key that starts a countdown shows it
   * at once rather than at the next beat.
   */
  tick(): void {
    const host = this.host;
    if (!host) return;

    const now = this.now();

    // A countdown that has arrived stops being a countdown that is running.
    // The flag turning over is itself an edge, which is the other half of what
    // a handler can wait for besides the number reaching zero.
    if (this.countdown.running && remaining(this.countdown, this.countdownTotal, now) === 0) {
      this.countdown = { running: false, banked: this.countdownTotal };
    }

    this.pomodoro = advance(this.pomodoro, this.plan(), now);

    const clock = new Date(now);
    this.set('clock.time', this.timeText(clock, false));
    this.set('clock.seconds', this.timeText(clock, true));
    this.set('clock.date', this.dateText(clock));
    this.set('clock.weekday', this.weekdayText(clock));

    const ran = elapsed(this.stopwatch, now);
    this.set('clock.stopwatch', formatSpan(ran));
    this.set('clock.stopwatch-seconds', ran);
    this.set('clock.stopwatch-running', this.stopwatch.running);

    const left = remaining(this.countdown, this.countdownTotal, now);
    this.set('clock.countdown', formatSpan(left));
    this.set('clock.countdown-seconds', left);
    this.set('clock.countdown-running', this.countdown.running);

    this.set('clock.pomodoro', formatSpan(remainingInPhase(this.pomodoro, this.plan(), now)));
    this.set('clock.pomodoro-phase', this.pomodoro.phase);
    this.set('clock.pomodoro-round', this.pomodoro.round);
    this.set('clock.pomodoro-running', this.pomodoro.running);

    this.ticker?.every(this.cadence());
  }

  /**
   * Written only if something reads it.
   *
   * The whole plugin turns on this line. A variable nobody shows still costs a
   * repaint of the page and a run of every handler when it changes, and this
   * one would change every second for ever.
   */
  private set(name: string, value: VariableValue): void {
    if (this.watched.has(name)) this.host?.setVariable(name, value);
  }

  /** A second, a minute, or nothing, according to what is being read. */
  private cadence(): number {
    if (this.watched.has('clock.seconds')) return 1000;

    // Only a timer that is actually running has anything new to say each
    // second; a paused stopwatch shows the same string for as long as it is
    // paused, however many keys are pointed at it.
    const ticking = [
      ...(this.stopwatch.running ? ['clock.stopwatch', 'clock.stopwatch-seconds'] : []),
      ...(this.countdown.running ? ['clock.countdown', 'clock.countdown-seconds'] : []),
      ...(this.pomodoro.running ? ['clock.pomodoro'] : []),
    ];
    if (ticking.some((name) => this.watched.has(name))) return 1000;

    return PER_MINUTE.some((name) => this.watched.has(name)) ? 60_000 : 0;
  }

  private plan(): Plan {
    const settings = this.host?.settings() ?? {};
    const minutes = (name: string, fallback: number): number => {
      const value = Number(settings[name]);
      return Number.isFinite(value) && value > 0 ? Math.round(value) * 60 : fallback * 60;
    };

    const rounds = Number(settings['rounds']);

    return {
      work: minutes('work', 25),
      rest: minutes('rest', 5),
      longRest: minutes('longRest', 15),
      rounds: Number.isFinite(rounds) && rounds > 0 ? Math.round(rounds) : 4,
    };
  }

  // --- saying the time ------------------------------------------------------

  private get locale(): string | undefined {
    const chosen = this.host?.settings()['locale'];
    return typeof chosen === 'string' && chosen.trim() !== '' ? chosen.trim() : undefined;
  }

  private get hour12(): boolean {
    return this.host?.settings()['hour12'] === true;
  }

  private timeText(at: Date, seconds: boolean): string {
    return at.toLocaleTimeString(this.locale, {
      hour: '2-digit',
      minute: '2-digit',
      ...(seconds ? { second: '2-digit' } : {}),
      hour12: this.hour12,
    });
  }

  private dateText(at: Date): string {
    return at.toLocaleDateString(this.locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  private weekdayText(at: Date): string {
    return at.toLocaleDateString(this.locale, { weekday: 'short' });
  }
}

/** Installs the clock: its manifest with the registry, its life with the runtime. */
export async function registerClockPlugin(
  registry: ActionRegistry,
  runtime: PluginRuntime,
  now: () => number = Date.now,
): Promise<ClockPlugin> {
  const plugin = new ClockPlugin(now);

  /** An action saved before this verb existed, or with the field left blank. */
  const verb = (params: Readonly<Record<string, unknown>>, fallback: string): string =>
    typeof params['do'] === 'string' && params['do'] !== '' ? params['do'] : fallback;

  registry.installPlugin(clockManifest, {
    'clock.stopwatch': (params) => plugin.stopwatchAction(verb(params, 'toggle')),

    'clock.countdown': (params) => {
      const minutes = numberParam(params, 'minutes', 5);
      const seconds = numberParam(params, 'seconds', 0);
      plugin.countdownAction(verb(params, 'restart'), minutes * 60 + seconds);
    },

    'clock.pomodoro': (params) => plugin.pomodoroAction(verb(params, 'toggle')),
  });

  await runtime.install(clockManifest, plugin);
  return plugin;
}
