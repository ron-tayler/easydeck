import { access, statfs } from 'node:fs/promises';
import { cpus, freemem, totalmem } from 'node:os';

import { PLUGIN_API_VERSION } from '@easydeck/engine';
import type {
  ActionRegistry,
  ButtonPreset,
  Plugin,
  PluginHost,
  PluginManifest,
  PresetButton,
  VariableDeclaration,
} from '@easydeck/engine';

import type { PluginRuntime } from '../../application/plugin-runtime.js';

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
export function hardwareManifest(disks: readonly Disk[]): PluginManifest {
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

  return {
    id: HARDWARE_PLUGIN_ID,
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
): ButtonPreset {
  const button: PresetButton = {
    stateFrom: variable,
    states: [
      {
        id: 'calm',
        when: { max: 59 },
        visual: { background: '#22303c', label: { text, fontSize: 13 } },
      },
      {
        id: 'busy',
        when: { min: 60, max: 84 },
        visual: { background: '#6b5416', label: { text, fontSize: 13 } },
      },
      {
        id: 'hot',
        when: { min: 85 },
        visual: { background: '#7a2c2c', label: { text, fontSize: 13 } },
      },
    ],
  };

  return { name, label, description, button };
}

export class HardwarePlugin implements Plugin {
  private fast?: NodeJS.Timeout;
  private slow?: NodeJS.Timeout;
  /** The processor counters as they were last time, to subtract from. */
  private previous = sampleCpu();

  constructor(
    private readonly disks: readonly Disk[],
    private readonly options: HardwareOptions = {},
  ) {}

  start(host: PluginHost): void {
    host.setVariable('hw.memory-total', round(totalmem() / GIB, 1));

    this.fast = setInterval(() => this.readFast(host), this.options.fastIntervalMs ?? FAST_INTERVAL_MS);
    this.slow = setInterval(() => void this.readDisks(host), this.options.diskIntervalMs ?? DISK_INTERVAL_MS);

    // Neither timer is a reason for the process to stay alive.
    this.fast.unref?.();
    this.slow.unref?.();

    void this.readDisks(host);
    host.setStatus('ready');
  }

  stop(): void {
    if (this.fast) clearInterval(this.fast);
    if (this.slow) clearInterval(this.slow);
    this.fast = undefined;
    this.slow = undefined;
  }

  /**
   * Processor and memory, rounded to what is worth showing.
   *
   * Whole percents and one decimal of a gigabyte, deliberately: the store
   * stays quiet when a value does not change, so rounding here is what keeps
   * an idle machine from repainting a key every two seconds over the third
   * decimal place of nothing happening.
   */
  private readFast(host: PluginHost): void {
    const now = sampleCpu();
    const busy = now.total - this.previous.total;
    const idle = now.idle - this.previous.idle;
    this.previous = now;

    if (busy > 0) host.setVariable('hw.cpu', Math.round((1 - idle / busy) * 100));

    const total = totalmem();
    const free = freemem();
    host.setVariable('hw.memory', Math.round(((total - free) / total) * 100));
    host.setVariable('hw.memory-used', round((total - free) / GIB, 1));
    host.setVariable('hw.memory-free', round(free / GIB, 1));
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
  const manifest = hardwareManifest(disks);

  // Registered with the action registry as well, despite having no actions:
  // that is where variable declarations come from, and without it the
  // configurator would have no idea `hw.cpu` exists until it first changed.
  registry.installPlugin(manifest, {});
  await runtime.install(manifest, new HardwarePlugin(disks, options));
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
