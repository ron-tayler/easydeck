import { KOFFI, loadCom } from './win32-com.js';

/**
 * Windows' performance counters, as much of them as anything here needs.
 *
 * PDH is a plain C API — no interfaces, no vtables, four functions and a
 * struct — and it is how this package reads the numbers Task Manager shows,
 * without a vendor library and without administrator rights.
 *
 * Split out because there are now two things asking: the graphics card and the
 * network adapters. The awkward parts are the same for both — a rate counter
 * needs two collections with a gap between them, and a counter with `(*)` in
 * its path answers with an array whose size has to be asked for first — and
 * they are the parts worth having in one place.
 */

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

interface Api {
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

let api: Api | undefined;
let loaded = false;

/** Binds pdh.dll once, and answers with nothing anywhere it is not there. */
async function load(): Promise<Api | undefined> {
  if (loaded) return api;
  loaded = true;

  if (!(await loadCom())) return undefined;

  try {
    const library = KOFFI.load('pdh.dll');
    const out = KOFFI.out;
    const inout = KOFFI.inout;
    const pointer = KOFFI.pointer;

    api = {
      open: library.func('__stdcall', 'PdhOpenQueryW', 'long', [
        'char16_t *',
        'uintptr_t',
        out(pointer('void *')),
      ]) as Api['open'],
      // The English form, so a Russian or German Windows is asked the same
      // question: the localised names differ and the counter does not.
      add: library.func('__stdcall', 'PdhAddEnglishCounterW', 'long', [
        'void *',
        'char16_t *',
        'uintptr_t',
        out(pointer('void *')),
      ]) as Api['add'],
      collect: library.func('__stdcall', 'PdhCollectQueryData', 'long', ['void *']) as Api['collect'],
      array: library.func('__stdcall', 'PdhGetFormattedCounterArrayW', 'long', [
        'void *',
        'uint32',
        inout(pointer('uint32')),
        out(pointer('uint32')),
        'void *',
      ]) as Api['array'],
    };

    return api;
  } catch {
    api = undefined;
    return undefined;
  }
}

/**
 * A query with its counters, open for as long as the thing that asked for it.
 *
 * Kept open rather than reopened per reading, because a rate is the difference
 * between two collections: a query that closed in between would report the
 * average since boot, every time, for ever.
 */
export class PdhQuery {
  private constructor(
    private readonly api: Api,
    private readonly handle: unknown,
    private readonly counters: ReadonlyMap<string, unknown>,
  ) {}

  /**
   * Opens a query holding the named counters.
   *
   * Nothing rather than a throw where PDH is absent or the counters are not
   * on this Windows — every caller here has something sensible to do with a
   * missing reading, and none of them has anything to do with an exception.
   *
   * A path that is refused is left out rather than failing the lot: the GPU
   * counters arrived in Windows 10 1709, and an older machine should lose the
   * cards and keep the network.
   */
  static async open(paths: Readonly<Record<string, string>>): Promise<PdhQuery | undefined> {
    const bound = await load();
    if (!bound) return undefined;

    const handle: unknown[] = [null];
    if (bound.open(null, 0, handle) !== 0) return undefined;

    const counters = new Map<string, unknown>();
    for (const [name, path] of Object.entries(paths)) {
      const counter: unknown[] = [null];
      if (bound.add(handle[0], path, 0, counter) === 0) counters.set(name, counter[0]);
    }

    if (counters.size === 0) return undefined;
    return new PdhQuery(bound, handle[0], counters);
  }

  has(name: string): boolean {
    return this.counters.has(name);
  }

  /** Takes a reading of every counter at once, which is what a rate needs. */
  collect(): boolean {
    return this.api.collect(this.handle) === 0;
  }

  /** Every instance of one counter, or nothing if it cannot be read this time. */
  items(name: string): CounterItem[] {
    const counter = this.counters.get(name);
    if (!counter) return [];

    const size: unknown[] = [0];
    const count: unknown[] = [0];

    // Asked twice on purpose: the first call is how PDH says how much room the
    // answer needs, and the number of instances changes with every program
    // that opens or closes.
    if (this.api.array(counter, PDH_FMT_DOUBLE, size, count, null) !== PDH_MORE_DATA) return [];

    const buffer = Buffer.alloc(Number(size[0]));
    if (this.api.array(counter, PDH_FMT_DOUBLE, size, count, buffer) !== 0) return [];

    const found: CounterItem[] = [];
    for (let index = 0; index < Number(count[0]); index++) {
      const at = index * ITEM_BYTES;
      const name = KOFFI.decode(KOFFI.decode(buffer, at, 'void *'), 'char16_t', -1) as unknown as string;
      const value = KOFFI.decode(buffer, at + VALUE_AT, 'double') as unknown as number;
      found.push({ name, value });
    }

    return found;
  }
}
