import { access, statfs } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';

import { PLUGIN_API_VERSION } from '@easydeck/engine';
import type {
  ActionRegistry,
  ButtonPreset,
  Plugin,
  PluginHost,
  PluginManifest,
  ParamOption,
  PresetButton,
  SurfaceFrame,
  SurfaceRequest,
  Ticker,
  VariableDeclaration,
} from '@easydeck/engine';

import type { PluginRuntime } from '../../application/plugin-runtime.js';
import { gpuAvailable, readGpu, readGpuTemperature } from '../actions/win32-gpu.js';
import { History, drawGraph } from './hardware-graph.js';

/**
 * What the machine is doing, on a key.
 *
 * The first plugin that is not a list of actions at all — it has none. It
 * exists to publish: the processor, the memory and the disks, as variables
 * that a label can show with `{{hw.cpu}}` and a state can bind to. Which
 * makes it the cheapest possible test of the whole live-key path, since
 * nothing here can fail to connect, ask for a password or need authorising.
 *
 * No native dependency either. `os.cpus()` carries the counters every system
 * keeps, `statfs` has been in Node since 18, and the arithmetic between them
 * is this file. A gauge that needed a compiler to install would be a poor
 * trade for two numbers.
 */

/**
 * How often the fast figures are taken.
 *
 * Two seconds rather than one, on purpose. A processor reading refreshed
 * every second is a JPEG pushed down the USB cable every second, and the
 * number jitters enough at that rate that it reads as noise rather than as
 * load. Two is still "live" to the eye.
 */
const FAST_INTERVAL_MS = 2_000;

/** Disks change slowly and cost a filesystem call each; once a minute is plenty. */
const DISK_INTERVAL_MS = 60_000;

/**
 * How often the card's temperature is asked for.
 *
 * Slower than the load, because this one starts a program to find out and
 * because a heatsink does not change its mind in two seconds. Fast enough that
 * a key still tells you a game got the fans going.
 */
const HEAT_INTERVAL_MS = 10_000;

/** The longest window a graph offers, and therefore how much to remember. */
const LONGEST_GRAPH_SECONDS = 900;

const GIB = 1024 ** 3;

export const HARDWARE_PLUGIN_ID = 'hardware';

/** A mounted volume worth reporting on, as found at startup. */
interface Disk {
  /** `C:\` on Windows, `/` elsewhere. */
  readonly root: string;
  /** The part of the variable name that identifies it: `c`, `d`, `root`. */
  readonly key: string;
  readonly label: string;
}

export interface HardwareOptions {
  readonly fastIntervalMs?: number;
  readonly diskIntervalMs?: number;
  readonly heatIntervalMs?: number;
}

/**
 * What the graphics card can be asked, on this machine.
 *
 * Two questions with different answers: Windows' own counters carry load and
 * memory for every card there is, while the temperature belongs to the card
 * and only its driver knows it. So a machine may have one, both or neither,
 * and the manifest is built from what actually answered.
 */
export interface GpuSupport {
  readonly counters: boolean;
  readonly temperature: boolean;
}

/**
 * Builds the manifest for the disks this machine actually has.
 *
 * Declared up front like every plugin's variables, but the list is only
 * knowable at startup: a manifest naming `hw.disk-d` on a machine with one
 * drive would offer the configurator a variable that never takes a value.
 * Disks that appear later — a stick, a card — are missed until the next
 * start, which is the right trade for a deck: a key bound to a drive that
 * comes and goes is not a key anybody wants.
 */
export function hardwareManifest(
  disks: readonly Disk[],
  gpu: GpuSupport = { counters: false, temperature: false },
): PluginManifest {
  const variables: VariableDeclaration[] = [
    {
      name: 'hw.cpu',
      type: 'number',
      label: { en: 'Processor, %', ru: 'Процессор, %' },
      initial: 0,
    },
    {
      name: 'hw.memory',
      type: 'number',
      label: { en: 'Memory used, %', ru: 'Память занята, %' },
      initial: 0,
    },
    {
      name: 'hw.memory-used',
      type: 'number',
      label: { en: 'Memory used, GB', ru: 'Память занята, ГБ' },
      initial: 0,
    },
    {
      name: 'hw.memory-free',
      type: 'number',
      label: { en: 'Memory free, GB', ru: 'Память свободна, ГБ' },
      initial: 0,
    },
    {
      name: 'hw.memory-total',
      type: 'number',
      label: { en: 'Memory total, GB', ru: 'Память всего, ГБ' },
      initial: 0,
    },
  ];

  if (gpu.counters) {
    variables.push(
      {
        name: 'hw.gpu',
        type: 'number',
        label: { en: 'Graphics card, %', ru: 'Видеокарта, %' },
        description: {
          en: 'Its busiest engine, which is the figure the task manager shows',
          ru: 'Самый занятый движок — то же число, что в диспетчере задач',
        },
        initial: 0,
      },
      {
        name: 'hw.gpu-memory',
        type: 'number',
        label: { en: 'Video memory used, %', ru: 'Видеопамять занята, %' },
        initial: 0,
      },
      {
        name: 'hw.gpu-memory-used',
        type: 'number',
        label: { en: 'Video memory used, GB', ru: 'Видеопамять занята, ГБ' },
        initial: 0,
      },
      {
        name: 'hw.gpu-memory-total',
        type: 'number',
        label: { en: 'Video memory total, GB', ru: 'Видеопамять всего, ГБ' },
        initial: 0,
      },
    );
  }

  if (gpu.temperature) {
    variables.push({
      name: 'hw.gpu-temperature',
      type: 'number',
      label: { en: 'Graphics card, °C', ru: 'Видеокарта, °C' },
      initial: 0,
    });
  }

  for (const disk of disks) {
    variables.push({
      name: `hw.disk-${disk.key}`,
      type: 'number',
      label: { en: `Disk ${disk.label} used, %`, ru: `Диск ${disk.label} занят, %` },
      initial: 0,
    });
    variables.push({
      name: `hw.disk-${disk.key}-free`,
      type: 'number',
      label: { en: `Disk ${disk.label} free, GB`, ru: `Диск ${disk.label} свободно, ГБ` },
      initial: 0,
    });
  }

  /**
   * What a graph can be drawn of: every reading that is a percentage.
   *
   * Built from the same list the variables are, so a machine without a
   * graphics card offers no graph of one — and adding a reading later puts it
   * in both places at once.
   */
  const graphable: ParamOption[] = variables
    .filter((variable) => (variable.label?.en ?? '').includes('%'))
    .map((variable) => ({
      value: variable.name,
      label: {
        en: (variable.label?.en ?? variable.name).replace(', %', ''),
        ru: (variable.label?.ru ?? variable.name).replace(', %', ''),
      },
    }));

  return {
    id: HARDWARE_PLUGIN_ID,
    surfaces: [
      {
        type: 'hardware.graph',
        label: { en: 'Graph over time', ru: 'График во времени' },
        description: {
          en: 'How a reading has moved over the last few seconds or minutes',
          ru: 'Как показатель менялся за последние секунды или минуты',
        },
        icon: 'variable',
        params: [
          {
            name: 'reading',
            type: 'select',
            label: { en: 'What to draw', ru: 'Что рисовать' },
            default: 'hw.cpu',
            options: graphable,
          },
          {
            name: 'period',
            type: 'select',
            label: { en: 'Over', ru: 'За период' },
            default: '60',
            options: [
              { value: '15', label: { en: '15 seconds', ru: '15 секунд' } },
              { value: '60', label: { en: 'A minute', ru: 'Минуту' } },
              { value: '300', label: { en: 'Five minutes', ru: 'Пять минут' } },
              { value: '900', label: { en: 'Fifteen minutes', ru: '15 минут' } },
            ],
          },
          {
            name: 'line',
            type: 'color',
            label: { en: 'Line', ru: 'Линия' },
            default: '#6ea8fe',
          },
          {
            name: 'fill',
            type: 'color',
            label: { en: 'Under the line', ru: 'Заливка под линией' },
            required: false,
            default: '#6ea8fe40',
            description: {
              en: 'Leave empty for a line alone',
              ru: 'Оставьте пустым, чтобы осталась только линия',
            },
          },
          {
            /*
             * Transparent by default, so the key's own background shows
             * through and the graph is one layer of the face rather than the
             * whole of it.
             */
            name: 'background',
            type: 'color',
            label: { en: 'Behind the graph', ru: 'Фон графика' },
            required: false,
            description: {
              en: "Empty lets the key's own background show through",
              ru: 'Пусто — виден собственный фон клавиши',
            },
          },
          {
            name: 'thickness',
            type: 'number',
            label: { en: 'Line thickness', ru: 'Толщина линии' },
            default: 4,
            min: 1,
            max: 20,
          },
        ],
      },
    ],
    name: { en: 'Hardware', ru: 'Железо' },
    description: {
      en: 'Processor, memory and disks, for keys that show them',
      ru: 'Процессор, память и диски — для кнопок, которые их показывают',
    },
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    builtIn: true,
    // None. It publishes; it does not do. A "refresh now" action would exist
    // only to give the palette something to show.
    actions: [],
    variables,
    presets: [
      {
        name: 'CPU',
        label: {en: "Processor", ru: 'Процессор'},
        description: {en: "Load, coloured as it climbs", ru: "Нагрузка, с цветом по мере роста"},
        button: {
          states: [{
            id: 'default',
            visual: {
              label: {
                text: 'CPU\n{{hw.cpu}}%',
                color: '#ffffff',
                position: 'center',
                fontSize: 20,
              },
              icon: {source: `plugin:hardware/cpu.svg`}
            }
          }]
        }
      },
      {
        name: 'memory',
        label: {en: "Memory", ru: 'Память'},
        description: {en: "How much of the memory is in use", ru: "Сколько памяти занято"},
        button: {
          states: [{
            id: 'default',
            visual: {
              label: {
                text: 'RAM\n{{hw.memory}}%',
                color: '#ffffff',
                position: 'center',
                fontSize: 20,
              },
              icon: {source: `plugin:hardware/ram.svg`}
            }
          }]
        }
      },
      ...(gpu.counters
        ? [
            {
              name: 'gpu',
              label: { en: 'Graphics card', ru: 'Видеокарта' },
              description: {
                en: 'Load, coloured as it climbs',
                ru: 'Нагрузка, с цветом по мере роста',
              },
              button: {
                states: [
                  {
                    id: 'default',
                    visual: {
                      label: {
                        text: 'GPU\n{{hw.gpu}}%',
                        color: '#ffffff',
                        position: 'center' as const,
                        fontSize: 20,
                      },
                      icon: { source: 'plugin:hardware/gpu.svg' },
                    },
                  },
                ],
              },
            },
            {
              name: 'gpu-memory',
              label: { en: 'Video memory', ru: 'Видеопамять' },
              description: {
                en: 'How much of the card’s memory is in use',
                ru: 'Сколько видеопамяти занято',
              },
              button: {
                states: [
                  {
                    id: 'default',
                    visual: {
                      label: {
                        text: 'VRAM\n{{hw.gpu-memory-used}} GB',
                        color: '#ffffff',
                        position: 'center' as const,
                        fontSize: 15,
                      },
                      icon: { source: 'plugin:hardware/gpu.svg' },
                    },
                  },
                ],
              },
            },
          ]
        : []),
      ...(gpu.temperature
        ? [
            {
              name: 'gpu-temperature',
              label: { en: 'Graphics card heat', ru: 'Нагрев видеокарты' },
              description: {
                en: 'Comfortable, working, and worth looking at',
                ru: 'Спокойно, под нагрузкой и стоит посмотреть',
              },
              button: gauge(
                'gpu-temperature',
                { en: 'Graphics card heat', ru: 'Нагрев видеокарты' },
                'hw.gpu-temperature',
                'GPU\n{{hw.gpu-temperature}}°',
                { en: '', ru: '' },
                [65, 80],
              ).button,
            },
          ]
        : []),
      ...disks.map((disk)=>({
        name: `disk-${disk.key}`,
        label: { en: `Disk ${disk.label}`, ru: `Диск ${disk.label}` },
        description: {
          en: `Free space on ${disk.label}`,
          ru: `Свободное место на ${disk.label}`,
        },
        button: {
          states: [{
            id: 'default',
            visual: {
              label: {
                text: `${disk.label}:\n{{hw.disk-${disk.key}-free}} GB`,
                color: '#ffffff',
                position: 'center' as const,
                fontSize: 13,
              },
              icon: {source: `plugin:hardware/disk.svg`}
            }
          }]
        }
      })),
    ],
  };
}

/**
 * Three bands and a label: the shape every one of these gauges wants.
 *
 * Written once because they differ only in which variable they watch and what
 * they say. The thresholds are the ordinary ones — comfortable below 60,
 * working below 85, and worth looking at above — and a user who disagrees
 * edits them, which is the point of a preset being an ordinary button once it
 * lands.
 */
function gauge(
  name: string,
  label: { en: string; ru: string },
  variable: string,
  text: string,
  description: { en: string; ru: string },
  /*
   * Where comfortable ends and where worth-looking-at begins.
   *
   * Percentages and degrees do not share a scale — eighty-five percent of a
   * processor is busy, eighty-five degrees on a card is warm but ordinary —
   * so the two thresholds come from the caller rather than being the same
   * numbers for everything with a band on it.
   */
  bands: readonly [number, number] = [60, 85],
): ButtonPreset {
  const [busy, hot] = bands;

  const button: PresetButton = {
    stateFrom: variable,
    states: [
      {
        id: 'calm',
        when: { max: busy - 1 },
        visual: { background: '#22303c', label: { text, fontSize: 13 } },
      },
      {
        id: 'busy',
        when: { min: busy, max: hot - 1 },
        visual: { background: '#6b5416', label: { text, fontSize: 13 } },
      },
      {
        id: 'hot',
        when: { min: hot },
        visual: { background: '#7a2c2c', label: { text, fontSize: 13 } },
      },
    ],
  };

  return { name, label, description, button };
}

export class HardwarePlugin implements Plugin {
  private fast?: Ticker;
  private slow?: Ticker;
  private heat?: Ticker;
  /** The processor counters as they were last time, to subtract from. */
  private previous = sampleCpu();
  /**
   * What each percentage has been doing, kept whether or not anything shows it.
   *
   * Recorded unconditionally on purpose. A graph is only *drawn* while its key
   * is on screen, but it has to be able to show the last five minutes the
   * moment somebody turns to that page — and five minutes of history cannot be
   * collected after the question is asked.
   */
  private readonly history = new Map<string, History>();

  constructor(
    private readonly disks: readonly Disk[],
    private readonly gpu: GpuSupport = { counters: false, temperature: false },
    private readonly options: HardwareOptions = {},
  ) {}

  start(host: PluginHost): void {
    host.setVariable('hw.memory-total', round(totalmem() / GIB, 1));

    /*
     * Asked for only while a key showing it is on screen, so nothing here
     * needs to know whether anybody is looking — the question never arrives
     * for a folder nobody has open.
     */
    host.provideSurface('hardware.graph', async (request) => this.graph(request));

    /*
     * Three rhythms, registered separately, because the three cost different
     * amounts and change at different speeds. The host keeps all of them, and
     * stopping this plugin is what stops them rather than a promise that it
     * will.
     */
    this.fast = host.update(this.options.fastIntervalMs ?? FAST_INTERVAL_MS, () => this.readFast(host));
    this.slow = host.update(this.options.diskIntervalMs ?? DISK_INTERVAL_MS, () => this.readDisks(host));

    if (this.gpu.temperature) {
      // Its own beat: this one starts a program, which the other two do not,
      // and a card's heat does not move fast enough to be worth two seconds.
      this.heat = host.update(this.options.heatIntervalMs ?? HEAT_INTERVAL_MS, () => this.readHeat(host));
      void this.readHeat(host);
    }

    void this.readDisks(host);
    host.setStatus('ready');
  }

  stop(): void {
    this.fast?.stop();
    this.slow?.stop();
    this.heat?.stop();
    this.fast = undefined;
    this.slow = undefined;
    this.heat = undefined;
  }

  /**
   * Processor and memory, rounded to what is worth showing.
   *
   * Whole percents and one decimal of a gigabyte, deliberately: the store
   * stays quiet when a value does not change, so rounding here is what keeps
   * an idle machine from repainting a key every two seconds over the third
   * decimal place of nothing happening.
   */
  private async readFast(host: PluginHost): Promise<void> {
    const now = sampleCpu();
    const busy = now.total - this.previous.total;
    const idle = now.idle - this.previous.idle;
    this.previous = now;

    if (busy > 0) this.publish(host, 'hw.cpu', Math.round((1 - idle / busy) * 100));

    const total = totalmem();
    const free = freemem();
    this.publish(host, 'hw.memory', Math.round(((total - free) / total) * 100));
    host.setVariable('hw.memory-used', round((total - free) / GIB, 1));
    host.setVariable('hw.memory-free', round(free / GIB, 1));

    if (this.gpu.counters) await this.readGraphics(host);
  }

  /**
   * The card, on the same beat as the processor and for the same reason: it is
   * a live reading, and a key showing one is showing what is happening now.
   *
   * A reading with nothing in it leaves the variables as they were. The
   * counters occasionally answer with no instances at all — a driver
   * restarting, a card going to sleep — and blanking a key for one bad sample
   * would look like the card had gone.
   */
  private async readGraphics(host: PluginHost): Promise<void> {
    const reading = await readGpu();

    if (reading.load !== undefined) this.publish(host, 'hw.gpu', reading.load);
    if (reading.memoryUsed !== undefined) host.setVariable('hw.gpu-memory-used', reading.memoryUsed);
    if (reading.memoryTotal !== undefined) {
      host.setVariable('hw.gpu-memory-total', reading.memoryTotal);
    }

    if (reading.memoryUsed !== undefined && reading.memoryTotal) {
      this.publish(host, 'hw.gpu-memory', Math.round((reading.memoryUsed / reading.memoryTotal) * 100));
    }
  }

  /**
   * Publishes a percentage and remembers it.
   *
   * One call for both, so a reading that gets a variable also gets a history
   * and nobody has to keep the two lists in step by hand.
   */
  private publish(host: PluginHost, name: string, value: number): void {
    host.setVariable(name, value);

    let kept = this.history.get(name);
    if (!kept) {
      const beat = (this.options.fastIntervalMs ?? FAST_INTERVAL_MS) / 1000;
      kept = new History(Math.ceil(LONGEST_GRAPH_SECONDS / beat) + 1);
      this.history.set(name, kept);
    }
    kept.push(value);
  }

  /**
   * The picture for one key, from the history this plugin has been keeping.
   *
   * The history is kept per reading and at the fast beat's resolution, so the
   * period the key asks for is a slice off the end rather than a different
   * recording. A key that wants fifteen seconds and one that wants fifteen
   * minutes read the same buffer.
   */
  private graph(request: SurfaceRequest): SurfaceFrame | undefined {
    const name = typeof request.params['reading'] === 'string' ? request.params['reading'] : 'hw.cpu';
    const history = this.history.get(name);
    if (!history) return undefined;

    const seconds = Number(request.params['period']) || 60;
    const beat = (this.options.fastIntervalMs ?? FAST_INTERVAL_MS) / 1000;
    const text = (key: string): string | undefined =>
      typeof request.params[key] === 'string' && request.params[key] !== ''
        ? (request.params[key] as string)
        : undefined;

    const source = drawGraph(
      history.recent(Math.max(2, Math.round(seconds / beat))),
      {
        line: text('line') ?? '#6ea8fe',
        ...(text('fill') ? { fill: text('fill')! } : {}),
        ...(text('background') ? { background: text('background')! } : {}),
        max: 100,
        thickness: Number(request.params['thickness']) || 4,
      },
      request.cols,
      request.rows,
    );

    // No id: every frame of a graph is its own picture and will never be
    // wanted again, so there is nothing worth recognising.
    return { source };
  }

  private async readHeat(host: PluginHost): Promise<void> {
    const degrees = await readGpuTemperature();
    if (degrees !== undefined) host.setVariable('hw.gpu-temperature', degrees);
  }

  private async readDisks(host: PluginHost): Promise<void> {
    for (const disk of this.disks) {
      try {
        const stats = await statfs(disk.root);
        const total = stats.blocks * stats.bsize;
        // `bavail` rather than `bfree`: the blocks reserved for root are not
        // free space to anybody looking at a key.
        const free = stats.bavail * stats.bsize;
        if (total <= 0) continue;

        host.setVariable(`hw.disk-${disk.key}`, Math.round(((total - free) / total) * 100));
        host.setVariable(`hw.disk-${disk.key}-free`, round(free / GIB, 1));
      } catch {
        // A drive that has gone — a card pulled, a network share dropped.
        // Its variables keep their last value rather than being cleared: a
        // disk is not a live reading, and blanking the key would suggest
        // something happened to the machine rather than to the drive.
      }
    }
  }
}

/**
 * The drives this machine has, as far as a deck cares.
 *
 * Windows is asked letter by letter because it has no listing that does not
 * involve a native call or spawning a program, and twenty-four failed
 * `access` calls at startup cost less than either.
 */
export async function findDisks(): Promise<Disk[]> {
  if (process.platform !== 'win32') {
    return [{ root: '/', key: 'root', label: '/' }];
  }

  const found: Disk[] = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZAB') {
    const root = `${letter}:\\`;
    try {
      await access(root);
      found.push({ root, key: letter.toLowerCase(), label: letter });
    } catch {
      // No such drive. The common case, and not worth reporting.
    }
  }
  return found;
}

/** Installs the plugin, having first found out what there is to report on. */
export async function registerHardwarePlugin(
  registry: ActionRegistry,
  runtime: PluginRuntime,
  options: HardwareOptions = {},
): Promise<void> {
  const disks = await findDisks();
  const gpu = await findGpu();
  const manifest = hardwareManifest(disks, gpu);

  // Registered with the action registry as well, despite having no actions:
  // that is where variable declarations come from, and without it the
  // configurator would have no idea `hw.cpu` exists until it first changed.
  registry.installPlugin(manifest, {});
  await runtime.install(manifest, new HardwarePlugin(disks, gpu, options));
}

/**
 * What this machine's card will answer, asked once at startup.
 *
 * Both questions are put now rather than at the first reading, for the same
 * reason the disks are: a manifest offering `hw.gpu-temperature` on a machine
 * that cannot produce one offers a variable that stays empty for ever, and an
 * empty key says nothing about why.
 */
export async function findGpu(): Promise<GpuSupport> {
  const [counters, degrees] = await Promise.all([gpuAvailable(), readGpuTemperature()]);
  return { counters, temperature: degrees !== undefined };
}

function sampleCpu(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;

  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }

  return { idle, total };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
