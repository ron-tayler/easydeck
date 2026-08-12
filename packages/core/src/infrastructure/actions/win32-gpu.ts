import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { KOFFI, loadCom } from './win32-com.js';

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

/** One instance of a counter, as PDH hands it back. */
export interface CounterItem {
  readonly name: string;
  readonly value: number;
}

/** `PDH_FMT_DOUBLE`, and the status that means "the buffer was too small". */
const PDH_FMT_DOUBLE = 0x0000_0200;
const PDH_MORE_DATA = 0x800007d2 | 0;

/**
 * `LPWSTR szName; DWORD CStatus; <padding>; double value;` on 64-bit.
 *
 * Read by hand at these offsets rather than described to koffi as a struct:
 * the union in the middle is what makes it awkward to declare and trivial to
 * decode.
 */
const ITEM_BYTES = 24;
const VALUE_AT = 16;

const HKEY_LOCAL_MACHINE = 0x8000_0002;
const RRF_RT_REG_QWORD = 0x0000_0040;
const DISPLAY_CLASS = 'SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}';

const GIB = 1024 ** 3;

interface Pdh {
  readonly open: (source: unknown, user: number, out: unknown[]) => number;
  readonly add: (query: unknown, path: string, user: number, out: unknown[]) => number;
  readonly collect: (query: unknown) => number;
  readonly array: (
    counter: unknown,
    format: number,
    size: unknown[],
    count: unknown[],
    buffer: unknown,
  ) => number;
}

let pdh: Pdh | undefined;
let query: unknown;
let engines: unknown;
let adapters: unknown;
let primed = false;
let opened = false;

/**
 * Opens the query once and keeps it.
 *
 * A rate counter needs two collections with a gap between them, so the query
 * has to outlive a single reading — which is also why the first reading has no
 * load in it. Kept as module state rather than in the plugin, because there is
 * one set of counters on the machine however many things ask.
 */
async function open(): Promise<boolean> {
  if (opened) return pdh !== undefined;
  opened = true;

  if (!(await loadCom())) return false;

  try {
    const library = KOFFI.load('pdh.dll');
    const out = KOFFI.out;
    const inout = KOFFI.inout;
    const pointer = KOFFI.pointer;

    const api: Pdh = {
      open: library.func('__stdcall', 'PdhOpenQueryW', 'long', [
        'char16_t *',
        'uintptr_t',
        out(pointer('void *')),
      ]) as Pdh['open'],
      // The English form, so a Russian or German Windows is asked the same
      // question: the localised names differ and the counter does not.
      add: library.func('__stdcall', 'PdhAddEnglishCounterW', 'long', [
        'void *',
        'char16_t *',
        'uintptr_t',
        out(pointer('void *')),
      ]) as Pdh['add'],
      collect: library.func('__stdcall', 'PdhCollectQueryData', 'long', ['void *']) as Pdh['collect'],
      array: library.func('__stdcall', 'PdhGetFormattedCounterArrayW', 'long', [
        'void *',
        'uint32',
        inout(pointer('uint32')),
        out(pointer('uint32')),
        'void *',
      ]) as Pdh['array'],
    };

    const handle: unknown[] = [null];
    if (api.open(null, 0, handle) !== 0) return false;

    const engineOut: unknown[] = [null];
    const adapterOut: unknown[] = [null];
    const engineStatus = api.add(handle[0], '\\GPU Engine(*)\\Utilization Percentage', 0, engineOut);
    const adapterStatus = api.add(handle[0], '\\GPU Adapter Memory(*)\\Dedicated Usage', 0, adapterOut);

    // A Windows old enough to lack the GPU counters — they arrived in 10 1709
    // — leaves the plugin without these three variables and with the rest.
    if (engineStatus !== 0 && adapterStatus !== 0) return false;

    pdh = api;
    query = handle[0];
    engines = engineStatus === 0 ? engineOut[0] : undefined;
    adapters = adapterStatus === 0 ? adapterOut[0] : undefined;
    return true;
  } catch {
    pdh = undefined;
    return false;
  }
}

export async function gpuAvailable(): Promise<boolean> {
  return open();
}

/** Every instance of one counter, or nothing if it cannot be read this time. */
function items(counter: unknown): CounterItem[] {
  if (!pdh || !counter) return [];

  const size: unknown[] = [0];
  const count: unknown[] = [0];

  // Asked twice on purpose: the first call is how PDH says how much room the
  // answer needs, and the number of instances changes with every program that
  // opens or closes.
  if (pdh.array(counter, PDH_FMT_DOUBLE, size, count, null) !== PDH_MORE_DATA) return [];

  const buffer = Buffer.alloc(Number(size[0]));
  if (pdh.array(counter, PDH_FMT_DOUBLE, size, count, buffer) !== 0) return [];

  const found: CounterItem[] = [];
  for (let index = 0; index < Number(count[0]); index++) {
    const at = index * ITEM_BYTES;
    const name = KOFFI.decode(KOFFI.decode(buffer, at, 'void *'), 'char16_t', -1) as unknown as string;
    const value = KOFFI.decode(buffer, at + VALUE_AT, 'double') as unknown as number;
    found.push({ name, value });
  }

  return found;
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
  if (!(await open()) || !pdh) return {};

  if (pdh.collect(query) !== 0) return {};

  const total = await totalMemory();
  const size = total === undefined ? {} : { memoryTotal: total };

  // One collection is not a rate. The card's size is knowable straight away,
  // so the first reading carries that and nothing else.
  if (!primed) {
    primed = true;
    return size;
  }

  const load = loadFromEngines(items(engines));
  const used = usedFromAdapters(items(adapters));

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
