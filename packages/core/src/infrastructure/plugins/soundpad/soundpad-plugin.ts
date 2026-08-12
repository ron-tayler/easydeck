import { PLUGIN_API_VERSION, numberParam, stringParam } from '@easydeck/engine';
import type {
  ActionRegistry,
  ParamOption,
  Plugin,
  PluginHost,
  PluginManifest,
  Ticker,
  VariableValue,
} from '@easydeck/engine';

import type { PluginRuntime } from '../../../application/plugin-runtime.js';
import { SoundpadConnection } from './soundpad-connection.js';

/**
 * Soundpad, as a deck sees it.
 *
 * A soundboard is the thing a stream deck is bought for, and the awkward part
 * of it is not playing a sound — it is *naming* one. Soundpad addresses sounds
 * by their row number, so a key that plays a fanfare says `DoPlaySound(7)`,
 * and a seven that means something different after somebody reorders their list
 * is the whole problem. Hence the list behind the field: the number is what
 * gets stored, the title is what gets shown, and the field is refilled from
 * Soundpad every time it is opened.
 *
 * Unlike OBS, Soundpad says nothing on its own — no event stream, no callbacks,
 * one question and one answer. So what a key *shows* has to be polled, and
 * `onWatched` decides both how often and, more to the point, *what*: each value
 * here costs a round trip of its own, so asking for four when a key shows one
 * is three wasted trips a second, for ever.
 *
 * There is also nothing to ask about recording. Soundpad will start and stop
 * it, and has no `IsRecording` — so this plugin offers those two orders and
 * publishes no state for them, rather than a variable that would be a guess.
 */

export const SOUNDPAD_PLUGIN_ID = 'soundpad';

/** What Soundpad calls the four things playback can be doing. */
const STATUSES: Readonly<Record<string, string>> = {
  STOPPED: 'stopped',
  PLAYING: 'playing',
  PAUSED: 'paused',
  SEEKING: 'seeking',
};

/** Things that move while a sound plays, and are worth a second. */
const QUICK = ['soundpad.status', 'soundpad.playing', 'soundpad.position', 'soundpad.position-ms'];

/** Things a person changes by hand in Soundpad, which no event announces. */
const SLOW = [
  'soundpad.volume',
  'soundpad.muted',
  'soundpad.sound-count',
  'soundpad.duration',
  'soundpad.duration-ms',
];

const QUICK_INTERVAL_MS = 1_000;
const SLOW_INTERVAL_MS = 5_000;

/**
 * Which lines a sound goes out on.
 *
 * The first is not "both" but "whatever Soundpad is set to", and it is the
 * default because it is the honest one: Soundpad has this setting in its own
 * window, and a key that silently overrode it would make that window a lie.
 * It also sends the one-argument form, which is what Soundpad does on its own.
 */
const LINES = [
  { value: '', label: { en: 'As Soundpad is set up', ru: 'Как настроено в Soundpad' } },
  { value: 'both', label: { en: 'Speakers and microphone', ru: 'В колонки и в микрофон' } },
  { value: 'speakers', label: { en: 'Speakers only', ru: 'Только в колонки' } },
  { value: 'microphone', label: { en: 'Microphone only', ru: 'Только в микрофон' } },
];

export const soundpadManifest: PluginManifest = {
  id: SOUNDPAD_PLUGIN_ID,
  name: { en: 'Soundpad', ru: 'Soundpad' },
  description: {
    en: 'Plays the sounds from your Soundpad list, and its volume',
    ru: 'Проигрывает звуки из списка Soundpad и управляет его громкостью',
  },
  version: '1.0.0',
  apiVersion: PLUGIN_API_VERSION,
  builtIn: true,

  settings: [
    {
      /*
       * Off until asked for, as the OBS plugin is and for the same reason: a
       * machine with no Soundpad on it should not have something knocking on a
       * pipe every half minute for ever.
       */
      name: 'enabled',
      type: 'boolean',
      label: { en: 'Connect to Soundpad', ru: 'Подключаться к Soundpad' },
      default: false,
      required: false,
      description: {
        en: 'Soundpad needs no setting up: it always listens, and there is nothing to configure',
        ru: 'Soundpad настраивать не нужно: он всегда слушает, настраивать нечего',
      },
    },
  ],

  commands: [
    { name: 'reconnect', label: { en: 'Reconnect', ru: 'Переподключиться' }, icon: 'link' },
  ],

  variables: [
    {
      name: 'soundpad.connected',
      type: 'boolean',
      label: { en: 'Soundpad connected', ru: 'Soundpad подключён' },
      initial: false,
    },
    {
      name: 'soundpad.status',
      type: 'string',
      label: { en: 'What playback is doing', ru: 'Что с воспроизведением' },
      description: {
        en: 'stopped, playing, paused or seeking — compare against it to know which',
        ru: '«stopped», «playing», «paused» или «seeking» — сравнивайте, чтобы узнать',
      },
    },
    {
      name: 'soundpad.playing',
      type: 'boolean',
      label: { en: 'A sound is playing', ru: 'Звук играет' },
      initial: false,
    },
    {
      name: 'soundpad.volume',
      type: 'number',
      label: { en: 'Volume, %', ru: 'Громкость, %' },
      initial: 0,
    },
    {
      name: 'soundpad.muted',
      type: 'boolean',
      label: { en: 'Muted', ru: 'Звук выключен' },
      initial: false,
    },
    {
      name: 'soundpad.sound-count',
      type: 'number',
      label: { en: 'Sounds in the list', ru: 'Звуков в списке' },
      initial: 0,
    },
    {
      name: 'soundpad.position',
      type: 'string',
      label: { en: 'Position', ru: 'Позиция' },
      initial: '0:00',
    },
    {
      name: 'soundpad.position-ms',
      type: 'number',
      label: { en: 'Position, ms', ru: 'Позиция, мс' },
      description: {
        en: 'The number behind the position, for a handler to compare against',
        ru: 'Число за позицией — чтобы обработчик мог его сравнить',
      },
      initial: 0,
    },
    {
      name: 'soundpad.duration',
      type: 'string',
      label: { en: 'Length', ru: 'Длительность' },
      initial: '0:00',
    },
    {
      name: 'soundpad.duration-ms',
      type: 'number',
      label: { en: 'Length, ms', ru: 'Длительность, мс' },
      initial: 0,
    },
  ],

  actions: [
    {
      type: 'soundpad.play',
      icon: 'play-pause',
      label: { en: 'Play a sound', ru: 'Проиграть звук' },
      description: {
        en: 'Chosen from your Soundpad list, which is read afresh every time this field is opened',
        ru: 'Выбирается из списка Soundpad — список читается заново при каждом открытии поля',
      },
      params: [
        {
          name: 'sound',
          type: 'select',
          optionsFrom: 'sounds',
          label: { en: 'Sound', ru: 'Звук' },
          // Nothing to list means Soundpad is closed, and typing a row number
          // is a perfectly good answer — so no `emptyNote` here.
          placeholder: { en: 'Row number in Soundpad', ru: 'Номер строки в Soundpad' },
        },
        {
          name: 'lines',
          type: 'select',
          label: { en: 'Where to play it', ru: 'Куда проигрывать' },
          default: '',
          required: false,
          options: LINES,
        },
      ],
      group: { en: 'Sounds', ru: 'Звуки' },
    },
    {
      type: 'soundpad.play-random',
      icon: 'cycle',
      label: { en: 'Play a random sound', ru: 'Проиграть случайный звук' },
      params: [],
      group: { en: 'Sounds', ru: 'Звуки' },
    },
    {
      type: 'soundpad.play-previous',
      icon: 'previous',
      label: { en: 'Play the previous sound', ru: 'Проиграть предыдущий звук' },
      params: [],
      group: { en: 'Sounds', ru: 'Звуки' },
    },
    {
      type: 'soundpad.play-next',
      icon: 'next',
      label: { en: 'Play the next sound', ru: 'Проиграть следующий звук' },
      params: [],
      group: { en: 'Sounds', ru: 'Звуки' },
    },
    {
      type: 'soundpad.stop',
      icon: 'stop',
      label: { en: 'Stop', ru: 'Остановить' },
      params: [],
      group: { en: 'Sounds', ru: 'Звуки' },
    },
    {
      type: 'soundpad.toggle-pause',
      icon: 'play-pause',
      label: { en: 'Pause / resume', ru: 'Пауза / продолжить' },
      params: [],
      group: { en: 'Sounds', ru: 'Звуки' },
    },
    {
      type: 'soundpad.seek',
      icon: 'next',
      label: { en: 'Seek', ru: 'Перемотать' },
      description: {
        en: 'To a position in the sound, or by so much from where it is',
        ru: 'На позицию в звуке или на столько-то от текущей',
      },
      params: [
        {
          name: 'how',
          type: 'select',
          label: { en: 'How', ru: 'Как' },
          default: 'by',
          options: [
            { value: 'by', label: { en: 'By this much', ru: 'На столько-то' } },
            { value: 'to', label: { en: 'To this position', ru: 'На эту позицию' } },
          ],
        },
        {
          name: 'seconds',
          type: 'number',
          label: { en: 'Seconds', ru: 'Секунд' },
          default: 5,
          min: -600,
          max: 600,
          description: {
            en: 'A negative number goes backwards, where that means anything',
            ru: 'Отрицательное число — назад, там где это имеет смысл',
          },
        },
      ],
      group: { en: 'Sounds', ru: 'Звуки' },
    },

    {
      type: 'soundpad.set-volume',
      icon: 'volume-up',
      label: { en: 'Set volume', ru: 'Задать громкость' },
      params: [
        {
          name: 'percent',
          type: 'number',
          label: { en: 'Volume, %', ru: 'Громкость, %' },
          default: 100,
          min: 0,
          max: 100,
        },
      ],
      group: { en: 'Volume', ru: 'Громкость' },
    },
    {
      type: 'soundpad.adjust-volume',
      icon: 'volume-down',
      label: { en: 'Change volume', ru: 'Изменить громкость' },
      description: {
        en: 'Adds to the current volume; a negative number turns it down',
        ru: 'Прибавляет к текущей громкости; отрицательное число убавляет',
      },
      params: [
        {
          name: 'by',
          type: 'number',
          label: { en: 'Change, %', ru: 'Изменение, %' },
          default: -10,
          min: -100,
          max: 100,
        },
      ],
      group: { en: 'Volume', ru: 'Громкость' },
    },
    {
      type: 'soundpad.toggle-mute',
      icon: 'mute',
      label: { en: 'Mute / unmute', ru: 'Выключить / включить звук' },
      params: [],
      group: { en: 'Volume', ru: 'Громкость' },
    },

    {
      type: 'soundpad.record',
      icon: 'record',
      label: { en: 'Recording', ru: 'Запись' },
      description: {
        en: 'Soundpad cannot be asked whether it is recording, so this says which, not "toggle"',
        ru: 'Soundpad нельзя спросить, идёт ли запись, поэтому здесь не «переключить», а что именно',
      },
      params: [
        {
          name: 'do',
          type: 'select',
          label: { en: 'What to do', ru: 'Что сделать' },
          default: 'start',
          options: [
            { value: 'start', label: { en: 'Start recording', ru: 'Начать запись' } },
            { value: 'stop', label: { en: 'Stop recording', ru: 'Остановить запись' } },
          ],
        },
      ],
      group: { en: 'Recording', ru: 'Запись' },
    },
  ],

  presets: [
    {
      name: 'stop',
      label: { en: 'Stop', ru: 'Остановить' },
      description: { en: 'Stops whatever is playing', ru: 'Останавливает то, что играет' },
      button: {
        states: [
          {
            id: 'default',
            visual: {
              background: '#3a1f1f',
              label: { text: 'Стоп', color: '#ffffff', position: 'bottom', fontSize: 14 },
            },
            actions: { press: [{ type: 'soundpad.stop', params: {} }] },
          },
        ],
      },
    },
    {
      name: 'random',
      label: { en: 'Random sound', ru: 'Случайный звук' },
      description: {
        en: 'Plays anything from the list, which is the best key on any soundboard',
        ru: 'Играет что угодно из списка — лучшая клавиша любого саундборда',
      },
      button: {
        states: [
          {
            id: 'default',
            visual: {
              background: '#1f3a4d',
              label: { text: '🎲', color: '#ffffff', position: 'center', fontSize: 34 },
            },
            actions: { press: [{ type: 'soundpad.play-random', params: {} }] },
          },
        ],
      },
    },
    {
      name: 'mute',
      label: { en: 'Mute', ru: 'Заглушить' },
      description: {
        en: 'Goes dim while Soundpad is muted',
        ru: 'Гаснет, пока звук Soundpad выключен',
      },
      button: {
        stateFrom: 'soundpad.muted',
        states: [
          {
            id: 'on',
            when: false,
            visual: {
              background: '#1d2733',
              label: { text: '{{soundpad.volume}}%', color: '#ffffff', position: 'bottom', fontSize: 14 },
            },
            actions: { press: [{ type: 'soundpad.toggle-mute', params: {} }] },
          },
          {
            id: 'off',
            when: true,
            visual: {
              background: '#2a2f36',
              label: { text: '—', color: '#7d8590', position: 'center', fontSize: 26 },
            },
          },
        ],
      },
    },
  ],
};

export interface SoundpadPluginOptions {
  /** Overridden by tests, which listen on a pipe of their own. */
  readonly pipe?: string;
  readonly retryDelaysMs?: readonly number[];
}

export class SoundpadPlugin implements Plugin {
  private host?: PluginHost;
  private connection?: SoundpadConnection;
  private ticker?: Ticker;
  private watched = new Set<string>();
  /** What was last published, so an unchanged answer costs no repaint. */
  private readonly published = new Map<string, VariableValue>();

  constructor(private readonly options: SoundpadPluginOptions = {}) {}

  start(host: PluginHost): void {
    this.host = host;

    host.onWatched((keys) => {
      this.watched = new Set(keys);
      this.retime();
      void this.poll();
    });

    host.onSettingsChanged(() => this.reconnect());

    // Registered stopped: what is worth asking for depends on what is being
    // read, and at this point nothing has said.
    this.ticker = host.update(0, () => void this.poll());

    this.registerOptions(host);
    this.reconnect();
  }

  stop(): void {
    this.ticker?.stop();
    this.ticker = undefined;
    this.connection?.stop();
    this.connection = undefined;
    this.host = undefined;
  }

  /** Opens the pipe, or closes it and says so when the setting is off. */
  reconnect(): void {
    const host = this.host;
    if (!host) return;

    this.connection?.stop();
    this.connection = undefined;
    this.forget();

    if (host.settings()['enabled'] !== true) {
      host.setStatus('off', {
        en: 'Switched off. Turn it on to connect to Soundpad',
        ru: 'Выключено. Включите, чтобы подключаться к Soundpad',
      });
      // Said out loud rather than left empty: a key bound to this should read
      // "no" while the plugin is off, which is what is true.
      this.set('soundpad.connected', false);
      this.retime();
      return;
    }

    this.connection = new SoundpadConnection({
      ...(this.options.pipe === undefined ? {} : { pipe: this.options.pipe }),
      ...(this.options.retryDelaysMs === undefined ? {} : { retryDelaysMs: this.options.retryDelaysMs }),
      onState: (state, message) => this.onState(state, message),
      log: (level, message) => host.log(level, message),
    });

    this.connection.start();
  }

  private onState(state: 'connecting' | 'ready' | 'error', message?: string): void {
    const host = this.host;
    if (!host) return;

    const text = message === undefined ? undefined : { en: message, ru: message };

    if (state === 'ready') {
      host.setStatus('ready');
      this.set('soundpad.connected', true);
      this.retime();
      void this.poll();
      return;
    }

    host.setStatus(state === 'connecting' ? 'connecting' : 'error', text);
    this.set('soundpad.connected', false);

    /*
     * What was last known is cleared rather than left standing.
     *
     * A key showing `50%` for a Soundpad that has been closed for an hour is
     * worse than a key showing nothing: it is the same picture as a Soundpad
     * that is running and set to fifty.
     */
    if (state === 'error') this.forget('soundpad.connected');
    this.retime();
  }

  // --- the lists a configurator offers -------------------------------------

  /**
   * The sounds Soundpad has, by the number that plays them.
   *
   * Read when somebody opens the field rather than kept: the list is theirs to
   * edit while the deck runs, and a copy of it here would be a second version
   * of the truth that goes stale the first time they drag a row.
   *
   * The value is the row number, because that is all `DoPlaySound` understands.
   * Which means reordering the list in Soundpad does move what a key plays —
   * unavoidable, and the reason the title is shown beside the number rather
   * than instead of it.
   */
  private registerOptions(host: PluginHost): void {
    host.provideOptions('sounds', async () => {
      const list = await this.require().ask('GetSoundlist()');
      return soundOptions(list);
    });
  }

  // --- what a key asked for -------------------------------------------------

  async play(sound: string, lines: string): Promise<void> {
    const index = Number(sound);
    if (!Number.isFinite(index) || index < 1) {
      throw new TypeError(`'${sound}' is not a Soundpad row number`);
    }

    const whole = Math.round(index);

    // No third and fourth argument at all for "as Soundpad is set up": the
    // one-argument form is what Soundpad does by itself, and passing its own
    // setting back to it would be this plugin guessing what that setting is.
    if (lines === '' || lines === undefined) {
      await this.require().tell(`DoPlaySound(${whole})`);
      return;
    }

    const speakers = lines !== 'microphone';
    const microphone = lines !== 'speakers';
    await this.require().tell(`DoPlaySound(${whole}, ${speakers}, ${microphone})`);
  }

  async simple(command: string): Promise<void> {
    await this.require().tell(command);
  }

  async seek(how: string, seconds: number): Promise<void> {
    const ms = Math.round(seconds * 1000);
    await this.require().tell(how === 'to' ? `DoSeekMs(${Math.max(0, ms)})` : `DoJumpMs(${ms})`);
  }

  /**
   * Sets the volume, having first made sure it is a number.
   *
   * Measured, not assumed: `SetVolume(abc)` answers `R-200` and leaves the
   * volume at zero. Soundpad accepts nonsense and reports success, so the one
   * place that can refuse it is here.
   */
  async setVolume(percent: number): Promise<void> {
    await this.require().tell(`SetVolume(${clampVolume(percent)})`);
  }

  /** Reads before it writes, because "quieter" only means something against now. */
  async adjustVolume(by: number): Promise<void> {
    const connection = this.require();
    const current = Number(await connection.ask('GetVolume()'));
    const from = Number.isFinite(current) ? current : 0;

    await connection.tell(`SetVolume(${clampVolume(from + by)})`);
  }

  private require(): SoundpadConnection {
    const connection = this.connection;
    if (!connection?.connected) throw new Error('Soundpad is not connected');
    return connection;
  }

  // --- publishing -----------------------------------------------------------

  /**
   * Asks Soundpad for what somebody is actually looking at.
   *
   * The gate is on the *questions*, not on the answers. Every value here is a
   * round trip of its own, so the thrift `onWatched` buys elsewhere by skipping
   * a write buys real traffic here: a page showing only the volume asks one
   * question a beat instead of five.
   */
  private async poll(): Promise<void> {
    const connection = this.connection;
    if (!connection?.connected) return;

    try {
      if (this.anyWatched(['soundpad.status', 'soundpad.playing'])) {
        const status = STATUSES[(await connection.ask('GetPlayStatus()')).trim()] ?? 'stopped';
        this.set('soundpad.status', status);
        this.set('soundpad.playing', status === 'playing');
      }

      if (this.anyWatched(['soundpad.volume'])) {
        this.set('soundpad.volume', clampVolume(Number(await connection.ask('GetVolume()'))));
      }

      if (this.anyWatched(['soundpad.muted'])) {
        this.set('soundpad.muted', (await connection.ask('IsMuted()')).trim() === '1');
      }

      if (this.anyWatched(['soundpad.sound-count'])) {
        this.set('soundpad.sound-count', whole(await connection.ask('GetSoundFileCount()')));
      }

      if (this.anyWatched(['soundpad.position', 'soundpad.position-ms'])) {
        const ms = whole(await connection.ask('GetPlaybackPositionInMs()'));
        this.set('soundpad.position-ms', ms);
        this.set('soundpad.position', asClock(ms));
      }

      if (this.anyWatched(['soundpad.duration', 'soundpad.duration-ms'])) {
        const ms = whole(await connection.ask('GetPlaybackDurationInMs()'));
        this.set('soundpad.duration-ms', ms);
        this.set('soundpad.duration', asClock(ms));
      }
    } catch (cause) {
      // Soundpad going away mid-poll. The connection reports that itself and
      // starts retrying; there is nothing to add and nothing to alarm anybody
      // with, so this only says so in the log.
      this.host?.log('warn', `Could not read Soundpad: ${reason(cause)}`);
    }
  }

  /** A second while something moves, five while nothing does, and none at all. */
  private retime(): void {
    if (!this.connection?.connected) {
      this.ticker?.every(0);
      return;
    }

    if (this.anyWatched(QUICK)) this.ticker?.every(QUICK_INTERVAL_MS);
    else if (this.anyWatched(SLOW)) this.ticker?.every(SLOW_INTERVAL_MS);
    else this.ticker?.every(0);
  }

  private anyWatched(names: readonly string[]): boolean {
    return names.some((name) => this.watched.has(name));
  }

  /**
   * Written only if something reads it, and only if it changed.
   *
   * The second half matters more here than elsewhere: this polls, so it
   * arrives at the same answer over and over, and a write that repeats the
   * value still costs a repaint of the page and a run of every handler.
   */
  private set(name: string, value: VariableValue): void {
    if (!this.watched.has(name) && name !== 'soundpad.connected') return;
    if (this.published.get(name) === value) return;

    this.published.set(name, value);
    this.host?.setVariable(name, value);
  }

  /** Clears what was published, except whatever is named as still true. */
  private forget(...keep: readonly string[]): void {
    for (const name of this.published.keys()) {
      if (keep.includes(name)) continue;
      this.host?.setVariable(name, undefined);
    }

    const kept = keep
      .filter((name) => this.published.has(name))
      .map((name) => [name, this.published.get(name)!] as const);

    this.published.clear();
    for (const [name, value] of kept) this.published.set(name, value);
  }
}

/** Installs the plugin: its actions with the registry, its life with the runtime. */
export async function registerSoundpadPlugin(
  registry: ActionRegistry,
  runtime: PluginRuntime,
  options: SoundpadPluginOptions = {},
): Promise<SoundpadPlugin> {
  const plugin = new SoundpadPlugin(options);

  registry.installPlugin(soundpadManifest, {
    'soundpad.play': async (params) =>
      plugin.play(stringParam(params, 'sound'), String(params['lines'] ?? '')),

    'soundpad.play-random': async () => plugin.simple('DoPlayRandomSound()'),
    'soundpad.play-previous': async () => plugin.simple('DoPlayPreviousSound()'),
    'soundpad.play-next': async () => plugin.simple('DoPlayNextSound()'),
    'soundpad.stop': async () => plugin.simple('DoStopSound()'),
    'soundpad.toggle-pause': async () => plugin.simple('DoTogglePause()'),
    'soundpad.toggle-mute': async () => plugin.simple('DoToggleMute()'),

    'soundpad.seek': async (params) =>
      plugin.seek(String(params['how'] ?? 'by'), numberParam(params, 'seconds', 5)),

    'soundpad.set-volume': async (params) => plugin.setVolume(numberParam(params, 'percent', 100)),
    'soundpad.adjust-volume': async (params) => plugin.adjustVolume(numberParam(params, 'by', -10)),

    'soundpad.record': async (params) =>
      plugin.simple(params['do'] === 'stop' ? 'DoStopRecording()' : 'DoStartRecording()'),
  });

  await runtime.install(soundpadManifest, plugin);
  runtime.registerCommands(SOUNDPAD_PLUGIN_ID, { reconnect: () => plugin.reconnect() });

  return plugin;
}

/**
 * The rows of a sound list, as choices.
 *
 * Parsed with a regular expression rather than an XML library, which is the
 * same trade the rest of this package makes: the document is two attributes
 * deep, generated by one program, and a dependency to read it would be more to
 * carry than to gain.
 *
 * A sound with no title falls back to its file name — Soundpad leaves the title
 * empty for a file with no tags, and a list of blank rows is no list at all.
 */
export function soundOptions(xml: string): ParamOption[] {
  const found: ParamOption[] = [];

  for (const row of xml.matchAll(/<Sound\b([^>]*)\/>/g)) {
    const attributes = row[1] ?? '';
    const index = attribute(attributes, 'index');
    if (index === undefined || index === '') continue;

    const title = attribute(attributes, 'title') ?? '';
    const url = attribute(attributes, 'url') ?? '';
    const name = title !== '' ? title : fileName(url);

    found.push({ value: index, label: { en: `${index}. ${name}` } });
  }

  return found;
}

function attribute(attributes: string, name: string): string | undefined {
  const found = new RegExp(`\\b${name}="([^"]*)"`).exec(attributes);
  return found ? unescapeXml(found[1] ?? '') : undefined;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function fileName(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut < 0 ? path : path.slice(cut + 1);
}

/**
 * A duration as a key shows it: `4:59`, and `1:04:59` once there is an hour.
 *
 * Written here rather than borrowed from the clock plugin, which has the same
 * function. Every built-in plugin has to be liftable out of this build on its
 * own — that is the plan for the ones that will live in their own repository —
 * and a plugin that cannot leave without taking another with it is not.
 */
function asClock(ms: number): string {
  const whole = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Soundpad answers in decimal text; anything else counts as nothing. */
function whole(answer: string): number {
  const value = Number(answer.trim());
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function clampVolume(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
