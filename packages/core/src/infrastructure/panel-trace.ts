import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { configDir } from './config-paths.js';

/**
 * A record of what happened to a key, for the questions logs are the only way
 * to answer.
 *
 * "The key kept the picture it had when I pressed it" is a race between three
 * things — a finger, a scene change, and a shrink that takes a moment — and no
 * two of them are visible at once from inside the program. Reproducing it by
 * hand is guesswork; the line that says which of the three arrived last is not.
 *
 * Only decisive events are written: a press, a release, a scene clearing keys,
 * a smaller copy drawn or thrown away. Animation frames are left out on
 * purpose — at thirty a second they would bury the one line that matters.
 */

const FILE = 'panel-trace.log';
/** Rewritten from the top past this, so a long session cannot fill a disk. */
const MAX_BYTES = 2 * 1024 * 1024;

export interface PanelTrace {
  readonly write: (event: string, detail?: Readonly<Record<string, unknown>>) => void;
  readonly path: string;
}

/**
 * Opens the trace, or returns undefined when it is switched off.
 *
 * Off by default, and on by `EASYDECK_TRACE=1`: writing a line per press to
 * everybody's disk forever is not a courtesy, and the file is only ever read
 * when something is being chased.
 */
export function openPanelTrace(): PanelTrace | undefined {
  if (process.env['EASYDECK_TRACE'] !== '1') return undefined;

  const path = process.env['EASYDECK_TRACE_FILE'] ?? join(configDir(), FILE);

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `# EasyDeck panel trace, started ${new Date().toISOString()}\n`);
  } catch {
    // A trace that cannot be written is not worth taking the daemon down for.
    return undefined;
  }

  const started = Date.now();

  return {
    path,
    write(event, detail) {
      const since = String(Date.now() - started).padStart(7, ' ');
      const line = `${since}ms ${event}${detail ? ` ${JSON.stringify(detail)}` : ''}\n`;

      try {
        // Rewound rather than rotated: the interesting part is always the last
        // few seconds, and a second file to look in is a second thing to ask
        // for.
        if (statSync(path).size > MAX_BYTES) writeFileSync(path, '# rewound\n');
        appendFileSync(path, line);
      } catch {
        // Ignored on purpose: see above.
      }
    },
  };
}
