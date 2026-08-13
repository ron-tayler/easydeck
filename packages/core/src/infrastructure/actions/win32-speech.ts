import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/**
 * Saying something out loud, through whatever Windows speaks with.
 *
 * A deck has no window to put a message in. Everything a key can say it says
 * with a picture, and the moment worth saying something about — the stream
 * dropped, the timer finished — is exactly the moment nobody is looking at the
 * panel. The clock plugin already reached for this and settled for a system
 * sound; this is the same idea with words in it.
 *
 * SAPI through a short-lived PowerShell rather than through COM directly.
 * Measured on the developer's machine: about half a second from starting the
 * process to the first sound, of which five hundred milliseconds is creating
 * the voice object. That is fine for something announcing an event and would
 * not be for a key that beeps under the finger — but the alternatives are a
 * PowerShell sitting resident for the once-an-hour it is used, or hand-written
 * vtable offsets into `ISpVoice`, where being one slot out is not a wrong
 * answer but a crashed daemon.
 *
 * Windows only. Elsewhere this does nothing rather than shelling out to
 * whichever synthesiser happens to be installed, which is the same choice the
 * system sounds next door make and for the same reason.
 */

/** SAPI's own range, and the numbers its own properties take. */
export const RATE_RANGE = { min: -10, max: 10 } as const;
export const VOLUME_RANGE = { min: 0, max: 100 } as const;

/**
 * How many phrases may be waiting before the oldest is dropped.
 *
 * A handler that fires in a loop would otherwise build a queue the machine
 * spends the next ten minutes reading out. The oldest goes rather than the
 * newest, because the point of every one of these is to be news.
 */
const QUEUE_LIMIT = 8;

export interface SpeechRequest {
  readonly text: string;
  /** As `GetDescription` reports it; empty means whichever Windows prefers. */
  readonly voice?: string;
  readonly rate?: number;
  readonly volume?: number;
  /** Cuts off whatever is being said rather than waiting its turn. */
  readonly interrupt?: boolean;
}

const speakable = process.platform === 'win32';

let speaking: ChildProcess | undefined;
const waiting: SpeechRequest[] = [];

export function speechAvailable(): boolean {
  return speakable;
}

/**
 * Says something, eventually.
 *
 * Returns as soon as the phrase is accepted rather than when it has been read
 * out: a key press must not wait several seconds for a sentence, and the whole
 * point of announcing something is that nobody is standing over it.
 *
 * One at a time, because two of these talking over each other is two phrases
 * nobody can make out — which is worse than the second one waiting a moment.
 */
export function speak(request: SpeechRequest): void {
  if (!speakable || request.text.trim() === '') return;

  if (request.interrupt) {
    waiting.length = 0;
    stop();
  }

  waiting.push(request);
  // The oldest goes: every one of these is news, and stale news is the part
  // worth losing.
  while (waiting.length > QUEUE_LIMIT) waiting.shift();

  if (!speaking) next();
}

/** Cuts off whatever is being said, and forgets what was waiting. */
export function stop(): void {
  const running = speaking;
  speaking = undefined;
  running?.kill();
}

function next(): void {
  const request = waiting.shift();
  if (!request) return;

  const child = execFile(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', '-'],
    { windowsHide: true },
    () => {
      // Whatever happened — spoken, killed, PowerShell missing — the queue
      // moves on. A phrase that would not come out is not a reason for the
      // next one to be stuck behind it for ever.
      if (speaking === child) {
        speaking = undefined;
        next();
      }
    },
  );

  speaking = child;
  child.on('error', () => undefined);

  child.stdin?.end(script(request), 'utf8');
}

/**
 * The PowerShell that does it, with everything quoted rather than interpolated.
 *
 * The text is whatever somebody typed on a key — and it is a template, so it
 * may also be whatever a plugin published into a variable. It reaches a shell,
 * so nothing here may be pasted in raw: it is written as a single-quoted
 * PowerShell literal with the one dangerous character doubled, which is the
 * whole of that language's escaping rule.
 */
export function script(request: SpeechRequest): string {
  const lines = [
    '$ErrorActionPreference = "Stop"',
    '$voice = New-Object -ComObject SAPI.SpVoice',
  ];

  if (request.voice) {
    /*
     * Chosen by description, matched rather than compared: what SAPI reports
     * is the long form — "Microsoft Irina Desktop - Russian" — and a voice
     * that has been uninstalled should leave the phrase spoken in whatever
     * Windows prefers rather than not spoken at all.
     */
    lines.push(
      `$wanted = ${literal(request.voice)}`,
      '$found = $voice.GetVoices() | Where-Object { $_.GetDescription() -eq $wanted } | Select-Object -First 1',
      'if ($found) { $voice.Voice = $found }',
    );
  }

  if (request.rate !== undefined) lines.push(`$voice.Rate = ${clamp(request.rate, RATE_RANGE)}`);
  if (request.volume !== undefined) {
    lines.push(`$voice.Volume = ${clamp(request.volume, VOLUME_RANGE)}`);
  }

  // Spoken synchronously *inside the process*, so the process living is what
  // "still speaking" means — which is what makes killing it an interruption
  // and its exit the cue for the next phrase.
  lines.push(`$voice.Speak(${literal(request.text)}) | Out-Null`);

  return lines.join('\n');
}

/** Every installed voice, as Windows describes them. */
export async function listVoices(): Promise<string[]> {
  if (!speakable) return [];

  return new Promise((resolve) => {
    const child = execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', '-'],
      { windowsHide: true, timeout: 5_000 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }

        resolve(
          String(stdout)
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line !== ''),
        );
      },
    );

    child.on('error', () => resolve([]));
    child.stdin?.end(
      '(New-Object -ComObject SAPI.SpVoice).GetVoices() | ForEach-Object { $_.GetDescription() }',
      'utf8',
    );
  });
}

/** A PowerShell single-quoted string, where the only escape is doubling. */
export function literal(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function clamp(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}
