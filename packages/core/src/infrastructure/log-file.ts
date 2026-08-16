import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { logsDir } from './config-paths.js';

/**
 * The log, as a file somebody can send you.
 *
 * A deck fails in the one place nobody is looking: a key was pressed, nothing
 * happened, and by the time anybody thinks to ask why, the window that would
 * have printed it is long closed — if there ever was one, which for a program
 * that starts minimised there is not. So it goes to a file, beside the
 * profiles and the plugin settings, where "send me your log" is one sentence.
 *
 * **Synchronous on purpose.** Everything written here is a line, the writes
 * are rare, and the one moment a log matters most is the moment before a
 * crash — an asynchronous write is a line that was queued and never made it
 * to disk. Which is exactly the line somebody needed.
 *
 * Rotation is two rules with one mechanism. Every start pushes the previous
 * run down a number, so a log is one run and comparing "before and after the
 * restart" is comparing two files. And a run that writes past the size limit
 * pushes itself down mid-way, because one bad plugin in a loop should cost a
 * few megabytes rather than the disk.
 */

/** Where the newest lines are; older runs are `easydeck.1.log` and so on. */
const CURRENT = 'easydeck.log';

/**
 * How big one file may get before it is pushed down.
 *
 * A megabyte is tens of thousands of lines — far more than a session writes,
 * and small enough to attach to a message without thinking about it.
 */
const MAX_BYTES = 1024 * 1024;

/**
 * How many are kept, the current one included.
 *
 * Five is the answer to "it broke a couple of restarts ago" and not to "I
 * would like a history": the deck is not an audit trail, and a folder that
 * grows for ever is a folder somebody finds in a year at four gigabytes.
 */
const KEEP = 5;

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogOptions {
  /** Where the files go. Overridden by tests. */
  readonly directory?: string;
  readonly maxBytes?: number;
  readonly keep?: number;
  /**
   * Also print to the console.
   *
   * On while a terminal is watching, which is how the headless runner and
   * every example are used; off in the packaged app, where stdout goes
   * nowhere and writing to it is only a cost.
   */
  readonly echo?: boolean;
}

export class LogFile {
  private readonly directory: string;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly echo: boolean;

  /** What the current file weighs, so the size is not stat'd per line. */
  private written = 0;
  private ready = false;

  constructor(options: LogOptions = {}) {
    this.directory = options.directory ?? logsDir();
    this.maxBytes = options.maxBytes ?? MAX_BYTES;
    this.keep = Math.max(1, options.keep ?? KEEP);
    this.echo = options.echo ?? false;
  }

  /**
   * Pushes the last run down and begins a new file.
   *
   * Called once, at start. Separate from the constructor because building a
   * logger must not have a side effect on somebody's disk — a test that makes
   * one to check a message would otherwise rotate their logs.
   */
  start(banner?: string): void {
    try {
      mkdirSync(this.directory, { recursive: true });
      this.rotate();
      this.ready = true;
    } catch {
      /*
       * A log that cannot be opened must not stop the program.
       *
       * A read-only profile folder, a path that turned out to be a file, a
       * disk that is full: none of them is a reason for a deck not to run,
       * and this is the one place where saying so is impossible anyway.
       */
      this.ready = false;
      return;
    }

    if (banner) this.write('info', banner);
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  /**
   * Something failed, with whatever is known about why.
   *
   * The cause is unwrapped rather than printed as one line: an action failure
   * says "Action 'x' on button 'b' failed" and carries the real reason —
   * "Discord is not connected" — underneath it, and the reason is the whole
   * point of writing it down.
   */
  error(message: string, cause?: unknown): void {
    this.write('error', cause === undefined ? message : `${message}: ${describe(cause)}`);
  }

  write(level: LogLevel, message: string): void {
    // A single line, so a log can be grepped and a stack does not break the
    // shape. Line breaks inside a message become a visible marker instead.
    const line = `${stamp()} ${level.toUpperCase().padEnd(5)} ${message.replace(/\r?\n/g, ' ⏎ ')}\n`;

    if (this.echo) {
      const to = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      to(line.trimEnd());
    }

    if (!this.ready) return;

    try {
      // Rotated *before* writing when the line would push it over, so the
      // limit is a limit rather than a suggestion.
      if (this.written + line.length > this.maxBytes) {
        this.rotate();
        this.written = 0;
      }

      appendFileSync(join(this.directory, CURRENT), line, 'utf8');
      this.written += Buffer.byteLength(line);
    } catch {
      // A log that cannot be written must not take the program with it: a
      // read-only folder, a full disk, a file somebody has open in a viewer.
      this.ready = false;
    }
  }

  /**
   * Moves every file down one number and drops the oldest.
   *
   * Counted downwards so nothing is overwritten on the way: renaming 1 to 2
   * before 2 to 3 would leave one file where two should be.
   */
  private rotate(): void {
    try {
      rmSync(join(this.directory, numbered(this.keep - 1)), { force: true });

      for (let index = this.keep - 2; index >= 1; index -= 1) {
        move(join(this.directory, numbered(index)), join(this.directory, numbered(index + 1)));
      }

      move(join(this.directory, CURRENT), join(this.directory, numbered(1)));
      this.written = 0;
    } catch {
      // Whatever could not be moved stays where it is, and the new lines join
      // the file that is already there. A tidy history is worth less than a
      // program that starts.
    }
  }

  /** Where the files are, for a window that offers to open the folder. */
  get path(): string {
    return this.directory;
  }
}

/** `easydeck.1.log`, `easydeck.2.log`: older the higher the number. */
function numbered(index: number): string {
  return `easydeck.${index}.log`;
}

function move(from: string, to: string): void {
  try {
    statSync(from);
  } catch {
    return; // nothing there yet, which is every file on a first run
  }

  renameSync(from, to);
}

/**
 * Local time, not UTC.
 *
 * A log is read by the person whose machine it came from, next to a memory of
 * when the thing happened — and "it stopped working around nine" is only
 * useful against a clock they recognise.
 */
function stamp(): string {
  const now = new Date();
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
  );
}

/**
 * An error, and the error underneath it.
 *
 * `ActionFailedError` names the action and the button and keeps the real
 * reason as its cause — a log that printed only the outer message would say
 * that something failed and never what.
 */
export function describe(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);

  const inner = (cause as { cause?: unknown }).cause;
  return inner === undefined ? cause.message : `${cause.message} <- ${describe(inner)}`;
}
