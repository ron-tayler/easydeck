import {
  PLUGIN_API_VERSION,
  numberParam,
  readList,
  stringParam,
  variableKey,
} from '@easydeck/engine';
import type {
  ActionRegistry,
  Plugin,
  PluginHost,
  PluginManifest,
  Ticker,
  VariableValue,
} from '@easydeck/engine';

import type { PluginRuntime } from '../../../application/plugin-runtime.js';
import { SYSTEM_SOUNDS, playSystemSound } from '../../actions/win32-sound.js';
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

/**
 * The one of each a fresh install has, and what the presets point at.
 *
 * Here as well as in the manifest for the same reason the sounds are: the
 * manifest's `default` is what an untouched field shows, and nothing writes it
 * down until Save is pressed.
 */
const DEFAULT_NAMES = { timer: 'Таймер', stopwatch: 'Секундомер' } as const;

type SoundSetting = 'countdownSound' | 'pomodoroSound';

/**
 * What each moment sounds like until somebody says otherwise.
 *
 * Kept here as well as in the manifest because the two are read by different
 * things: the manifest's `default` is what the settings window shows in an
 * untouched field, and nothing writes it down until Save is pressed.
 */
const DEFAULT_SOUNDS: Record<SoundSetting, string> = {
  countdownSound: 'Notification.Reminder',
  pomodoroSound: 'Notification.Default',
};

/** The sounds a finished timer may make, with "none" first because it is one. */
const SOUND_OPTIONS = [
  { value: '', label: { en: 'No sound', ru: 'Без звука' } },
  ...SYSTEM_SOUNDS.map((sound) => ({
    value: sound.alias,
    label: { en: sound.en, ru: sound.ru },
  })),
];

const DOING = [
  { value: 'toggle', label: { en: 'Start or pause', ru: 'Пустить или остановить' } },
  { value: 'start', label: { en: 'Start', ru: 'Пустить' } },
  { value: 'stop', label: { en: 'Pause', ru: 'Остановить' } },
  { value: 'restart', label: { en: 'Start again from zero', ru: 'Начать заново с нуля' } },
  { value: 'reset', label: { en: 'Clear', ru: 'Сбросить' } },
];

/**
 * The verbs a key uses, without the one that has a macro of its own.
 *
 * `reset` is not here because clearing a timer has nothing to do with how long
 * it runs, and a form offering both would ask for a duration it would then
 * ignore. It is its own action instead — see the manifest.
 */
const RUNNING_DOING = DOING.filter((verb) => verb.value !== 'reset');

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
    /*
     * Which timers exist, kept here and nowhere else.
     *
     * They used to come into being by being named in the macro that started
     * one, which read well and worked badly: a typo made a second timer rather
     * than an error, every other key had to wait for the first press before it
     * had anything to choose from, and the list of what exists was scattered
     * across the profile. Declared here, every field that names one is an
     * ordinary list, and a name is right or it is not there.
     *
     * A stopwatch counts up and a timer counts down, which is the whole of the
     * difference — but it is enough of a difference to be asked for up front
     * rather than inferred from whether somebody filled in a duration.
     */
    {
      name: 'timers',
      type: 'list',
      label: { en: 'Timers', ru: 'Таймеры' },
      description: {
        en: 'Count down from a length a key gives them. Keys choose one by name',
        ru: 'Считают вниз от длительности, которую задаёт клавиша. Клавиши выбирают по названию',
      },
      default: 'Таймер',
      required: false,
      placeholder: { en: 'Name', ru: 'Название' },
    },
    {
      name: 'stopwatches',
      type: 'list',
      label: { en: 'Stopwatches', ru: 'Секундомеры' },
      description: {
        en: 'Count up from zero, with no length to give them',
        ru: 'Считают вверх от нуля, задавать им длительность не нужно',
      },
      default: 'Секундомер',
      required: false,
      placeholder: { en: 'Name', ru: 'Название' },
    },
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
      /*
       * Two settings rather than one, because they are different moments. A
       * countdown finishes when somebody asked it to and wants telling; a
       * pomodoro changes phase every twenty-five minutes all day, and what is
       * right for the first is wearing as the second.
       */
      name: 'countdownSound',
      type: 'select',
      label: { en: 'Sound when the countdown finishes', ru: 'Звук по окончании отсчёта' },
      default: DEFAULT_SOUNDS.countdownSound,
      required: false,
      options: SOUND_OPTIONS,
    },
    {
      name: 'pomodoroSound',
      type: 'select',
      label: { en: 'Sound when a pomodoro phase ends', ru: 'Звук при смене фазы помодоро' },
      default: DEFAULT_SOUNDS.pomodoroSound,
      required: false,
      options: SOUND_OPTIONS,
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

    /*
     * As many timers and stopwatches as the settings list.
     *
     * Families, so one declaration covers all of them and the key carries
     * which — `clock.timer(Кофе)` — and so a page showing one timer costs a
     * beat for that one rather than for every timer in the profile.
     */
    {
      name: 'clock.timer',
      type: 'string',
      label: { en: 'Timer', ru: 'Таймер' },
      argument: { label: { en: 'Name', ru: 'Название' }, optionsFrom: 'timers' },
    },
    {
      name: 'clock.timer-seconds',
      type: 'number',
      label: { en: 'Timer, seconds left', ru: 'Таймер, секунд осталось' },
      description: {
        en: 'Reaches zero and stays there, so a handler waiting for it fires once',
        ru: 'Доходит до нуля и остаётся там — обработчик срабатывает один раз',
      },
      argument: { label: { en: 'Name', ru: 'Название' }, optionsFrom: 'timers' },
    },
    {
      name: 'clock.timer-running',
      type: 'boolean',
      label: { en: 'Timer running', ru: 'Таймер идёт' },
      argument: { label: { en: 'Name', ru: 'Название' }, optionsFrom: 'timers' },
    },

    {
      name: 'clock.stopwatch',
      type: 'string',
      label: { en: 'Stopwatch', ru: 'Секундомер' },
      argument: { label: { en: 'Name', ru: 'Название' }, optionsFrom: 'stopwatches' },
    },
    {
      name: 'clock.stopwatch-seconds',
      type: 'number',
      label: { en: 'Stopwatch, seconds', ru: 'Секундомер, секунд' },
      description: {
        en: 'The number behind the stopwatch, for a handler to compare against',
        ru: 'Число за секундомером — чтобы обработчик мог его сравнить',
      },
      argument: { label: { en: 'Name', ru: 'Название' }, optionsFrom: 'stopwatches' },
    },
    {
      name: 'clock.stopwatch-running',
      type: 'boolean',
      label: { en: 'Stopwatch running', ru: 'Секундомер идёт' },
      argument: { label: { en: 'Name', ru: 'Название' }, optionsFrom: 'stopwatches' },
    },
  ],

  actions: [
    /*
     * Two actions apiece rather than one with five verbs on it.
     *
     * Clearing a timer has nothing to do with how long it runs, so an action
     * that offered both would ask for a duration and then ignore it. Splitting
     * on that line also happens to be how a key is used: a press starts and
     * pauses, a hold clears — two bindings, two actions, neither carrying a
     * field the other one needs.
     */
    {
      type: 'clock.timer',
      icon: 'clock',
      label: { en: 'Timer', ru: 'Таймер' },
      description: {
        en: 'Counts down to zero, where a handler can pick it up. Pressed again, it pauses',
        ru: 'Считает до нуля, там его подхватит обработчик. Нажатие ещё раз — пауза',
      },
      params: [
        {
          name: 'name',
          type: 'select',
          optionsFrom: 'timers',
          label: { en: 'Timer', ru: 'Таймер' },
          // Nothing to list means the settings list is empty, and no name
          // typed here could be right — so say where they come from.
          emptyNote: {
            en: 'No timers yet. Add one in this plugin’s settings',
            ru: 'Таймеров пока нет. Добавьте его в настройках этого плагина',
          },
        },
        {
          name: 'do',
          type: 'select',
          label: { en: 'What to do', ru: 'Что сделать' },
          default: 'toggle',
          options: RUNNING_DOING,
        },
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
      type: 'clock.timer-reset',
      icon: 'clock',
      label: { en: 'Clear a timer', ru: 'Сбросить таймер' },
      description: {
        en: 'Back to its full length and stopped. Good on a hold, beside a press that starts it',
        ru: 'Обратно на полную длительность и стоп. Удобно на зажатие рядом с нажатием',
      },
      params: [
        {
          name: 'name',
          type: 'select',
          optionsFrom: 'timers',
          label: { en: 'Timer', ru: 'Таймер' },
          emptyNote: {
            en: 'No timers yet. Add one in this plugin’s settings',
            ru: 'Таймеров пока нет. Добавьте его в настройках этого плагина',
          },
        },
      ],
    },

    {
      type: 'clock.stopwatch',
      icon: 'clock',
      label: { en: 'Stopwatch', ru: 'Секундомер' },
      description: {
        en: 'Counts up from zero. Pressed again, it pauses where it stands',
        ru: 'Считает вверх от нуля. Нажатие ещё раз — пауза на месте',
      },
      params: [
        {
          name: 'name',
          type: 'select',
          optionsFrom: 'stopwatches',
          label: { en: 'Stopwatch', ru: 'Секундомер' },
          emptyNote: {
            en: 'No stopwatches yet. Add one in this plugin’s settings',
            ru: 'Секундомеров пока нет. Добавьте его в настройках этого плагина',
          },
        },
        {
          name: 'do',
          type: 'select',
          label: { en: 'What to do', ru: 'Что сделать' },
          default: 'toggle',
          options: RUNNING_DOING,
        },
      ],
    },
    {
      type: 'clock.stopwatch-reset',
      icon: 'clock',
      label: { en: 'Clear a stopwatch', ru: 'Сбросить секундомер' },
      description: {
        en: 'Back to zero and stopped',
        ru: 'Обратно на ноль и стоп',
      },
      params: [
        {
          name: 'name',
          type: 'select',
          optionsFrom: 'stopwatches',
          label: { en: 'Stopwatch', ru: 'Секундомер' },
          emptyNote: {
            en: 'No stopwatches yet. Add one in this plugin’s settings',
            ru: 'Секундомеров пока нет. Добавьте его в настройках этого плагина',
          },
        },
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
    /*
     * Both of these name the timer the settings ship with.
     *
     * A preset is a finished key, and a key that names nothing would be a
     * preset that does nothing until somebody opens the settings — so the list
     * starts with one entry and these point at it. Rename it, and the key says
     * so plainly by ceasing to work; that is a better answer than a preset
     * that quietly picks whichever timer happens to be first.
     */
    {
      name: 'stopwatch',
      label: { en: 'Stopwatch', ru: 'Секундомер' },
      description: {
        en: 'Press to start and pause, hold to clear; it goes green while it runs',
        ru: 'Нажатие пускает и ставит на паузу, зажатие сбрасывает; на ходу зеленеет',
      },
      button: {
        stateFrom: 'clock.stopwatch-running(Секундомер)',
        states: [
          {
            id: 'stopped',
            when: false,
            visual: {
              background: '#1d2733',
              label: { text: '{{clock.stopwatch(Секундомер)}}', color: '#ffffff', position: 'center', fontSize: 24 },
              icon: { source: 'plugin:clock/stopwatch.svg' },
            },
            actions: {
              press: [{ type: 'clock.stopwatch', params: { name: 'Секундомер', do: 'toggle' } }],
              longPress: [{ type: 'clock.stopwatch-reset', params: { name: 'Секундомер' } }],
            },
          },
          {
            id: 'running',
            when: true,
            visual: {
              background: '#1f4d33',
              label: { text: '{{clock.stopwatch(Секундомер)}}', color: '#ffffff', position: 'center', fontSize: 24 },
            },
          },
        ],
      },
    },
    {
      name: 'countdown',
      label: { en: 'Timer, 5 minutes', ru: 'Таймер, 5 минут' },
      description: {
        en: 'Press to start and pause, hold to clear',
        ru: 'Нажатие пускает и ставит на паузу, зажатие сбрасывает',
      },
      button: {
        stateFrom: 'clock.timer-running(Таймер)',
        states: [
          {
            id: 'idle',
            when: false,
            visual: {
              background: '#1d2733',
              label: { text: '{{clock.timer(Таймер)}}', color: '#ffffff', position: 'center', fontSize: 24 },
              icon: { source: 'plugin:clock/countdown.svg' },
            },
            actions: {
              press: [
                { type: 'clock.timer', params: { name: 'Таймер', do: 'toggle', minutes: 5, seconds: 0 } },
              ],
              longPress: [{ type: 'clock.timer-reset', params: { name: 'Таймер' } }],
            },
          },
          {
            id: 'counting',
            when: true,
            visual: {
              background: '#4d3a1f',
              label: { text: '{{clock.timer(Таймер)}}', color: '#ffffff', position: 'center', fontSize: 24 },
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

/**
 * One of the timers somebody named, and how long it was given.
 *
 * `total` of zero counts up rather than down, which is the difference between
 * a stopwatch and a countdown and the only difference — everything else about
 * them is the same span with the same five verbs.
 */
interface Timer {
  readonly span: Span;
  readonly total: number;
}

/** Which of the two lists a name came from, and therefore which way it counts. */
type Kind = 'timer' | 'stopwatch';

export class ClockPlugin implements Plugin {
  private host?: PluginHost;
  private ticker?: Ticker;
  private watched = new Set<string>();

  private pomodoro: Pomodoro = FRESH;

  /**
   * The timers and stopwatches, by name, for as long as the daemon is up.
   *
   * Which ones exist comes from the settings; what they are *doing* is not
   * written down anywhere. A running stopwatch is a fact about this session,
   * and one restored across a restart saying fourteen hours is rubbish nobody
   * started — so a name in the settings comes back idle.
   */
  private readonly kept: Record<Kind, Map<string, Timer>> = {
    timer: new Map(),
    stopwatch: new Map(),
  };

  /**
   * Both of these are injectable so a test is at the mercy of neither the wall
   * clock nor the speakers.
   */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly play: (alias: string) => void = (alias) => void playSystemSound(alias),
  ) {}

  start(host: PluginHost): void {
    this.host = host;

    // The settings list, offered to every field that names one. Read through
    // `named` so the field and the plugin cannot disagree about what exists.
    host.provideOptions('timers', async () => this.choices('timer'));
    host.provideOptions('stopwatches', async () => this.choices('stopwatch'));

    host.onWatched((keys) => {
      this.watched = new Set(keys);
      this.tick();
    });

    // Registered stopped. What is worth ticking for depends on what is being
    // read, and at this point nothing has said.
    this.ticker = host.update(0, () => this.tick());

    host.onSettingsChanged(() => {
      this.sync();
      this.tick();
    });

    this.sync();
    this.tick();
    host.setStatus('ready');
  }

  stop(): void {
    this.ticker?.stop();
    this.ticker = undefined;
    this.host = undefined;
  }

  // --- which ones exist -----------------------------------------------------

  /**
   * The names in one of the settings lists, in the order they were typed.
   *
   * Falling back to what the manifest declares, the way every other setting
   * here does: a `default` is what the settings window puts in an untouched
   * field and is not written down until somebody presses Save. Without this a
   * fresh install would have no timers at all, and the presets that ship
   * pointing at one would be dead keys.
   *
   * An empty string is a different thing from an absent one, and the line that
   * keeps them apart is here: absent means nobody has been to the settings,
   * empty means somebody deleted the last row.
   */
  private named(kind: Kind): string[] {
    const name = kind === 'timer' ? 'timers' : 'stopwatches';
    const stored = this.host?.settings()[name];

    return readList(stored ?? DEFAULT_NAMES[kind]);
  }

  private choices(kind: Kind): { value: string; label: { en: string } }[] {
    return this.named(kind).map((name) => ({ value: name, label: { en: name } }));
  }

  /**
   * Brings what is running into line with what the settings say exists.
   *
   * A name added starts idle; a name taken away takes its variables with it,
   * because a key still showing `2:14` for a timer nobody can reach any more is
   * a key lying about the present. Renaming is the two of those together, which
   * is the honest reading: the old timer is gone and a new one is there.
   */
  private sync(): void {
    for (const kind of ['timer', 'stopwatch'] as const) {
      const wanted = this.named(kind);
      const running = this.kept[kind];

      for (const name of running.keys()) {
        if (wanted.includes(name)) continue;
        running.delete(name);
        this.clearOne(kind, name);
      }

      for (const name of wanted) {
        if (!running.has(name)) running.set(name, { span: IDLE, total: 0 });
      }
    }
  }

  // --- what a key asked for -------------------------------------------------

  /**
   * Starts, pauses or restarts one of them.
   *
   * `seconds` is what a *timer* counts down from, and it is taken whenever one
   * begins at the top — pointedly not when a paused one is resumed, where the
   * key would otherwise silently lengthen it. That is the whole of what makes a
   * single key work as start, then pause, then resume.
   *
   * A stopwatch has no length and passes zero, which is what makes it count up.
   */
  run(kind: Kind, name: string, what: string, seconds = 0): void {
    const timer = this.kept[kind].get(name.trim());
    if (!timer) return;

    const now = this.now();
    const fresh = !timer.span.running && elapsed(timer.span, now) === 0;
    const fromTheTop = what === 'restart' || (fresh && (what === 'start' || what === 'toggle'));

    this.kept[kind].set(name.trim(), {
      span: this.applied(timer.span, what, now),
      total: kind === 'timer' && fromTheTop ? Math.max(1, Math.round(seconds)) : timer.total,
    });

    this.tick();
  }

  /** Back to the start and stopped, keeping the length it was last given. */
  reset(kind: Kind, name: string): void {
    const timer = this.kept[kind].get(name.trim());
    if (!timer) return;

    this.kept[kind].set(name.trim(), { ...timer, span: IDLE });
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

    /*
     * Only the rollover the clock did by itself is announced.
     *
     * Every action advances the pomodoro before calling this, so by the time
     * we get here a skip or a start has already happened and leaves nothing to
     * notice — which is the point. Somebody who pressed "skip" watched
     * themselves do it and does not need telling.
     *
     * A plugin that has been quiet through two phases rolls through both and
     * makes one sound, not two.
     */
    const was = this.pomodoro;
    this.pomodoro = advance(this.pomodoro, this.plan(), now);
    const moved = this.pomodoro.phase !== was.phase || this.pomodoro.round !== was.round;
    // The round matters as much as the phase: rolling through a whole work and
    // a whole break lands back in `work`, and comparing the name alone would
    // decide nothing had happened.
    if (this.pomodoro.running && moved) this.announce('pomodoroSound');

    const clock = new Date(now);
    this.set('clock.time', this.timeText(clock, false));
    this.set('clock.seconds', this.timeText(clock, true));
    this.set('clock.date', this.dateText(clock));
    this.set('clock.weekday', this.weekdayText(clock));

    this.set('clock.pomodoro', formatSpan(remainingInPhase(this.pomodoro, this.plan(), now)));
    this.set('clock.pomodoro-phase', this.pomodoro.phase);
    this.set('clock.pomodoro-round', this.pomodoro.round);
    this.set('clock.pomodoro-running', this.pomodoro.running);

    this.tickTimers(now);

    this.ticker?.every(this.cadence());
  }

  /** Every timer and stopwatch, brought up to date and published. */
  private tickTimers(now: number): void {
    for (const kind of ['timer', 'stopwatch'] as const) {
      for (const [name, timer] of this.kept[kind]) {
        let span = timer.span;

        /*
         * A timer that has arrived stops being one that is running.
         *
         * The flag turning over is itself an edge, which is the other half of
         * what a handler can wait for besides the number reaching zero. A
         * stopwatch has no arrival, which is why this only asks about a total.
         */
        if (timer.total > 0 && span.running && remaining(span, timer.total, now) === 0) {
          span = { running: false, banked: timer.total };
          this.kept[kind].set(name, { ...timer, span });
          this.announce('countdownSound');
        }

        const seconds = timer.total > 0 ? remaining(span, timer.total, now) : elapsed(span, now);

        this.setFamily(`clock.${kind}`, name, formatSpan(seconds));
        this.setFamily(`clock.${kind}-seconds`, name, seconds);
        this.setFamily(`clock.${kind}-running`, name, span.running);
      }
    }
  }

  /**
   * Makes whichever noise the user chose for this moment, if any.
   *
   * Deliberately not `setVariable` and a handler: a sound is an output nobody
   * can see on a key, so `onWatched` says nothing about whether anybody wants
   * it. See `cadence` for what that costs.
   */
  private announce(setting: SoundSetting): void {
    const chosen = this.soundFor(setting);
    if (chosen) this.play(chosen);
  }

  /**
   * Which sound this moment gets, falling back the way every plugin here does.
   *
   * A `default` in the manifest is what the settings window puts in the field;
   * it is not written anywhere until somebody presses Save, so a plugin that
   * read only what was stored would be silent until the user opened its
   * settings and closed them again.
   *
   * An empty string is a different thing from an absent one, and this is the
   * line that keeps them apart: absent means nobody has chosen, empty means
   * somebody chose silence.
   */
  private soundFor(setting: SoundSetting): string {
    const chosen = this.host?.settings()[setting];
    return typeof chosen === 'string' ? chosen : DEFAULT_SOUNDS[setting];
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

  /** The same thrift for a family, whose keys arrive whole from `onWatched`. */
  private setFamily(family: string, argument: string, value: VariableValue): void {
    if (this.watched.has(variableKey(family, argument))) {
      this.host?.setFamily(family, argument, value);
    }
  }

  /** Takes a removed one's keys off the board rather than freezing them. */
  private clearOne(kind: Kind, name: string): void {
    for (const suffix of ['', '-seconds', '-running']) {
      this.host?.setFamily(`clock.${kind}${suffix}`, name, undefined);
    }
  }

  /** A second, a minute, or nothing, according to what is being read. */
  private cadence(): number {
    if (this.watched.has('clock.seconds')) return 1000;

    // Only a pomodoro that is actually running has anything new to say each
    // second; a paused one shows the same string for as long as it is paused,
    // however many keys are pointed at it.
    if (this.pomodoro.running && this.watched.has('clock.pomodoro')) return 1000;

    // The same rule for the named ones: a second is worth it only where one is
    // running *and* a key shows what it says.
    for (const kind of ['timer', 'stopwatch'] as const) {
      for (const [name, timer] of this.kept[kind]) {
        if (!timer.span.running) continue;
        if (
          this.watched.has(variableKey(`clock.${kind}`, name)) ||
          this.watched.has(variableKey(`clock.${kind}-seconds`, name))
        ) {
          return 1000;
        }
      }
    }

    /*
     * The one thing that beats without anybody watching.
     *
     * A sound is not a variable, so nothing reports that somebody is waiting
     * for it — and a timer that only makes its noise the next time a key
     * happens to look at it is a timer nobody would trust. So a running timer
     * with a sound set keeps the second, whether or not a key shows it.
     *
     * Narrow on purpose: it costs a beat only while a timer is actually
     * running and only for somebody who asked for the sound, which is exactly
     * when they want it.
     */
    if (this.awaited()) return 1000;

    return PER_MINUTE.some((name) => this.watched.has(name)) ? 60_000 : 0;
  }

  /** Whether a running timer owes somebody a noise. */
  private awaited(): boolean {
    if (this.pomodoro.running && this.soundFor('pomodoroSound') !== '') return true;
    if (this.soundFor('countdownSound') === '') return false;

    // A stopwatch counts up and has no end to announce, so only the timers
    // keep the beat alive for a sound nobody is watching.
    return [...this.kept.timer.values()].some((timer) => timer.total > 0 && timer.span.running);
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
  play?: (alias: string) => void,
): Promise<ClockPlugin> {
  const plugin = play ? new ClockPlugin(now, play) : new ClockPlugin(now);

  /** An action saved before this verb existed, or with the field left blank. */
  const verb = (params: Readonly<Record<string, unknown>>, fallback: string): string =>
    typeof params['do'] === 'string' && params['do'] !== '' ? params['do'] : fallback;

  registry.installPlugin(clockManifest, {
    'clock.timer': (params) => {
      const minutes = numberParam(params, 'minutes', 5);
      const seconds = numberParam(params, 'seconds', 0);
      plugin.run('timer', stringParam(params, 'name'), verb(params, 'toggle'), minutes * 60 + seconds);
    },
    'clock.timer-reset': (params) => plugin.reset('timer', stringParam(params, 'name')),

    'clock.stopwatch': (params) =>
      plugin.run('stopwatch', stringParam(params, 'name'), verb(params, 'toggle')),
    'clock.stopwatch-reset': (params) => plugin.reset('stopwatch', stringParam(params, 'name')),

    'clock.pomodoro': (params) => plugin.pomodoroAction(verb(params, 'toggle')),
  });

  await runtime.install(clockManifest, plugin);
  return plugin;
}
