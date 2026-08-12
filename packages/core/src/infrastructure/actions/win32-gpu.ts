import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { KOFFI } from './win32-com.js';
import { PdhQuery } from './win32-pdh.js';
import type { CounterItem } from './win32-pdh.js';

/**
 * What the graphics card is doing, as Windows itself measures it.
 *
 * Through the performance counters rather than a vendor's library, which is
 * the whole reason this is short: `GPU Engine` and `GPU Adapter Memory` are
 * the very counters Task Manager reads, they exist for every card — NVIDIA,
 * AMD, Intel, and the virtual ones — and none of it needs administrator
 * rights. A vendor SDK would have meant one of them working and the rest
 * showing an empty key.
 *
 * PDH is a plain C API, so this is far less work than the audio stack next
 * door: no interfaces, no vtables, five functions and a struct.
 *
 * The one thing the counters do not carry is temperature, which is a property
 * of the hardware rather than of Windows' scheduling of it. See below.
 */

const run = promisify(execFile);

export interface GpuReading {
  /** Busiest engine, as a whole percent — the number Task Manager shows. */
  readonly load?: number;
  /** Dedicated memory in use, in GiB. */
  readonly memoryUsed?: number;
  /** How much the card has, in GiB. */
  readonly memoryTotal?: number;
}

const HKEY_LOCAL_MACHINE = 0x8000_0002;
const RRF_RT_REG_QWORD = 0x0000_0040;
const DISPLAY_CLASS = 'SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';

const GIB = 1024 ** 3;

let query: PdhQuery | undefined;
let primed = false;
let opened = false;

/**
 * Opens the query once and keeps it.
 *
 * A rate counter needs two collections with a gap between them, so the query
 * has to outlive a single reading — which is also why the first reading has no
 * load in it. Kept as module state rather than in the plugin, because there is
 * one set of counters on the machine however many things ask.
 *
 * A Windows old enough to lack the GPU counters — they arrived in 10 1709 —
 * leaves the plugin without these three variables and with the rest.
 */
async function open(): Promise<boolean> {
  if (opened) return query !== undefined;
  opened = true;

  query = await PdhQuery.open({
    engines: '\\GPU Engine(*)\\Utilization Percentage',
    adapters: '\\GPU Adapter Memory(*)\\Dedicated Usage',
  });

  return query !== undefined;
}

export async function gpuAvailable(): Promise<boolean> {
  return open();
}

/**
 * The load, from several hundred per-process instances.
 *
 * Every program using the card has an instance per engine — 3D, VideoDecode,
 * Copy and a few more. Summing within an engine and taking the busiest engine
 * is what Task Manager puts in its GPU column; summing across engines instead
 * would report well over a hundred percent on a machine playing a video while
 * a game runs.
 */
export function loadFromEngines(instances: readonly CounterItem[]): number | undefined {
  if (instances.length === 0) return undefined;

  const byType = new Map<string, number>();
  for (const instance of instances) {
    const type = /engtype_(\w+)/i.exec(instance.name)?.[1]?.toLowerCase() ?? 'other';
    byType.set(type, (byType.get(type) ?? 0) + instance.value);
  }

  const busiest = Math.max(...byType.values());
  return Math.min(100, Math.round(busiest));
}

/**
 * The card in use, out of however many the machine reports.
 *
 * The largest is taken rather than the sum: a laptop has an integrated chip
 * beside the real one, and this desktop has two virtual adapters from a
 * headset and a screen-sharing tool. Adding them together would answer a
 * question nobody asked.
 */
export function usedFromAdapters(instances: readonly CounterItem[]): number | undefined {
  if (instances.length === 0) return undefined;
  return Math.max(...instances.map((instance) => instance.value));
}

/**
 * A reading, and the beat it is asked on is the interval it covers.
 *
 * The first call after opening has no load in it: a rate needs two collections
 * to subtract, and there has only been one.
 */
export async function readGpu(): Promise<GpuReading> {
  if (!(await open()) || !query) return {};

  if (!query.collect()) return {};

  const total = await totalMemory();
  const size = total === undefined ? {} : { memoryTotal: total };

  // One collection is not a rate. The card's size is knowable straight away,
  // so the first reading carries that and nothing else.
  if (!primed) {
    primed = true;
    return size;
  }

  const load = loadFromEngines(query.items('engines'));
  const used = usedFromAdapters(query.items('adapters'));

  return {
    ...size,
    ...(load === undefined ? {} : { load }),
    ...(used === undefined ? {} : { memoryUsed: round(used / GIB, 1) }),
  };
}

let knownTotal: number | undefined;

/**
 * How much memory the card has, from where the true number is kept.
 *
 * Not from `Win32_VideoController.AdapterRAM`, which is a 32-bit field and
 * reports a twelve-gigabyte card as four. The driver writes the real size into
 * its own registry key as a 64-bit value, and that is what Task Manager reads.
 *
 * Asked once: a card does not grow.
 */
async function totalMemory(): Promise<number | undefined> {
  if (knownTotal !== undefined) return knownTotal || undefined;
  knownTotal = 0;

  try {
    const advapi = KOFFI.load('advapi32.dll');
    const getValue = advapi.func('__stdcall', 'RegGetValueW', 'long', [
      'uintptr_t',
      'char16_t *',
      'char16_t *',
      'uint32',
      KOFFI.out(KOFFI.pointer('uint32')),
      'void *',
      KOFFI.inout(KOFFI.pointer('uint32')),
    ]);

    let largest = 0;
    // Adapters are numbered from 0000; the virtual ones simply have no such
    // value, which is how they take themselves out of the running.
    for (let index = 0; index < 16; index++) {
      const data = Buffer.alloc(8);
      const size: unknown[] = [8];
      const type: unknown[] = [0];
      const key = `${DISPLAY_CLASS}\\${String(index).padStart(4, '0')}`;

      const status = getValue(
        HKEY_LOCAL_MACHINE,
        key,
        'HardwareInformation.qwMemorySize',
        RRF_RT_REG_QWORD,
        type,
        data,
        size,
      );
      if (status !== 0) continue;

      largest = Math.max(largest, Number(data.readBigUInt64LE(0)));
    }

    knownTotal = largest > 0 ? round(largest / GIB, 1) : 0;
  } catch {
    knownTotal = 0;
  }

  return knownTotal || undefined;
}

/**
 * The temperature, which the performance counters do not carry.
 *
 * Windows measures how busy the card is; how hot it is belongs to the card,
 * and only its own driver knows. `nvidia-smi` ships with every NVIDIA driver
 * and sits in `system32`, so on those machines it is one call away and needs
 * no rights. On the rest this simply answers nothing, and the key that would
 * have shown it stays empty rather than showing a made-up number.
 */
export async function readGpuTemperature(): Promise<number | undefined> {
  if (process.platform !== 'win32') return undefined;

  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'],
      { timeout: 4000, windowsHide: true },
    );
    return parseTemperature(stdout);
  } catch {
    // No NVIDIA driver, or it did not answer. Either way there is no number.
    return undefined;
  }
}

/** The first card's reading, out of a line per card. */
export function parseTemperature(output: string): number | undefined {
  for (const line of output.split(/\r?\n/)) {
    const degrees = Number(line.trim());
    if (Number.isFinite(degrees) && line.trim() !== '') return Math.round(degrees);
  }
  return undefined;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
