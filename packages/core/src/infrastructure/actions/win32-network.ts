import { PdhQuery } from './win32-pdh.js';

/**
 * What each network adapter is carrying, as Windows itself measures it.
 *
 * `Network Interface` rather than `Network Adapter`, which sounds like the
 * wrong way round and is not: the *Interface* object holds only the adapters
 * that are up and carrying an address, while the *Adapter* object lists every
 * WAN miniport, Hyper-V switch and tunnelling pseudo-interface Windows has
 * ever installed. Measured on a desktop with one cable in it: Interface
 * answered with the Ethernet card, Adapter answered with twenty-one rows, of
 * which twenty were flat zero for ever.
 *
 * Bytes per second, both ways, and no administrator rights — the same counters
 * Task Manager's per-adapter view reads.
 */

export interface NetworkReading {
  /** Bytes per second coming in. */
  readonly down: number;
  /** Bytes per second going out. */
  readonly up: number;
}

let query: PdhQuery | undefined;
let opened = false;
let primed = false;

/**
 * Opens the query once and keeps it.
 *
 * A rate is the difference between two collections, so a query that closed in
 * between would report the average since boot, every time, for ever.
 */
async function open(): Promise<boolean> {
  if (opened) return query !== undefined;
  opened = true;

  query = await PdhQuery.open({
    down: '\\Network Interface(*)\\Bytes Received/sec',
    up: '\\Network Interface(*)\\Bytes Sent/sec',
  });

  return query !== undefined;
}

export async function networkAvailable(): Promise<boolean> {
  return open();
}

/**
 * Every adapter that is up, and what it is carrying right now.
 *
 * The first call after opening answers with the adapters and no traffic: one
 * collection is not a rate, and there has only been one.
 *
 * PDH writes `(` and `)` as `[` and `]` in an instance name, because
 * parentheses are what delimits the instance in a counter path. So an Intel
 * card comes back as `Intel[R] Ethernet Controller [3] I225-V`, and that is
 * the name to show as well as the name to match — inventing a prettier one
 * would leave a profile holding a name PDH has never heard of.
 */
export async function readNetwork(): Promise<Map<string, NetworkReading>> {
  const found = new Map<string, NetworkReading>();
  if (!(await open()) || !query) return found;
  if (!query.collect()) return found;

  for (const item of query.items('down')) {
    found.set(item.name, { down: primed ? Math.max(0, Math.round(item.value)) : 0, up: 0 });
  }

  for (const item of query.items('up')) {
    const already = found.get(item.name);
    const up = primed ? Math.max(0, Math.round(item.value)) : 0;
    found.set(item.name, { down: already?.down ?? 0, up });
  }

  primed = true;
  return found;
}

/**
 * A rate as a key shows it: `1,9 МБ/с`, three significant figures at most.
 *
 * Bytes rather than bits, because that is what the counters give and what
 * every file manager on the machine agrees with. Somebody who wants megabits
 * has the number to multiply.
 */
export function formatRate(bytesPerSecond: number, locale?: string): string {
  const units = ['б/с', 'к/с', 'м/с', 'г/с'];

  let value = Math.max(0, bytesPerSecond) * 8;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Whole numbers above ten, one decimal below it: `9,4 МБ/с` and `94 МБ/с`
  // are both four characters, which is what a key has room for.
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[unit]}`;
}
