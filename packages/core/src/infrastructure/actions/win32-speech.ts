import { execFile } from 'node:child_process';

import { call, create, guid, invoke, loadCom, release } from './win32-com.js';
import type { ComPointer } from './win32-com.js';

/**
 * Saying something out loud, through whatever Windows speaks with.
 *
 * A deck has no window to put a message in. Everything a key can say it says
 * with a picture, and the moment worth saying something about — the stream
 * dropped, the timer finished — is exactly the moment nobody is looking at the
 * panel. The clock plugin already reached for this and settled for a system
 * sound; this is the same idea with words in it.
 *
 * Straight to SAPI through COM, the way the audio stack next door is called.
 * The first attempt shelled out to PowerShell and was wrong twice over: a
 * phrase cost half a second of process startup before any sound, and — worse —
 * PowerShell reads its standard input in the console's code page, so a Russian
 * sentence arrived as sixty-five characters of mojibake and was read out as
 * such. Through COM there is no encoding step at all: a JavaScript string is
 * already UTF-16, which is exactly what SAPI takes.
 *
 * It also removes the shell, and with it the whole question of what happens
 * when a variable holding a chat message reaches a command line.
 *
 * The vtable slots below were verified rather than trusted: writing a rate and
 * reading the same number back out of the slot after it is evidence the layout
 * is what it is believed to be, and it costs nothing if it is not.
 *
 * Windows only. Elsewhere this does nothing rather than shelling out to
 * whichever synthesiser happens to be installed — the same choice the system
 * sounds next door make and for the same reason.
 */

const CLSID_SpVoice = guid('96749377-3391-11D2-9EE3-00C04F797396');
const IID_ISpVoice = guid('6C44DF74-72B9-4992-A1EC-EF996E0422D4');

/** Slots in `ISpVoice`, counted past `IUnknown`, `ISpNotifySource` and `ISpEventSource`. */
const SLOT = { speak: 20, setRate: 28, getRate: 29, setVolume: 30, getVolume: 31 } as const;

/**
 * `SPEAKFLAGS`, of which four matter here.
 *
 * `ASYNC` is what lets a key press return at once — measured at ten
 * milliseconds against the real thing — and it is also the queue: SAPI speaks
 * one phrase after another by itself, so nothing here has to.
 */
const SPF = { async: 1, purge: 2, isXml: 8, notXml: 16 } as const;

/** SAPI's own ranges, and the numbers its own properties take. */
export const RATE_RANGE = { min: -10, max: 10 } as const;
export const VOLUME_RANGE = { min: 0, max: 100 } as const;

export interface SpeechRequest {
  readonly text: string;
  /** As `GetDescription` reports it; empty means whichever Windows prefers. */
  readonly voice?: string;
  readonly rate?: number;
  readonly volume?: number;
  /** Throws away what is queued and cuts off what is being said. */
  readonly interrupt?: boolean;
}

let voice: ComPointer | undefined;
let opened = false;

/** Creates the voice once and keeps it, which is where the speed comes from. */
async function open(): Promise<ComPointer | undefined> {
  if (opened) return voice;
  opened = true;

  if (!(await loadCom())) return undefined;

  try {
    voice = create(CLSID_SpVoice, IID_ISpVoice, 'The speech voice');
  } catch {
    // A Windows without SAPI, or one where it will not start. The actions are
    // then quiet rather than broken.
    voice = undefined;
  }

  return voice;
}

export function speechAvailable(): boolean {
  return process.platform === 'win32';
}

/**
 * Says something, and returns long before it has been said.
 *
 * A key press must not wait several seconds for a sentence, and the whole
 * point of announcing something is that nobody is standing over it.
 *
 * One phrase after another, which is SAPI's own doing: an asynchronous `Speak`
 * queues. Interrupting is the other answer, for the key that reads out a
 * number every time it is pressed rather than announcing an event.
 */
export async function speak(request: SpeechRequest): Promise<void> {
  const text = request.text.trim();
  if (text === '') return;

  const self = await open();
  if (!self) return;

  try {
    if (request.rate !== undefined) {
      invoke(self, SLOT.setRate, ['long'], [clamp(request.rate, RATE_RANGE)], 'Setting the rate');
    }
    if (request.volume !== undefined) {
      invoke(
        self,
        SLOT.setVolume,
        ['uint16'],
        [clamp(request.volume, VOLUME_RANGE)],
        'Setting the volume',
      );
    }

    const flags = SPF.async | (request.interrupt ? SPF.purge : 0);

    /*
     * A named voice is asked for inside the text, which is SAPI's own markup
     * and saves enumerating voice tokens through three more interfaces whose
     * layout nobody here has verified.
     *
     * The price is that the text is then parsed as XML, so it has to be
     * escaped — and that a voice which has since been uninstalled is refused
     * outright rather than quietly substituted. Measured: `0x80045043`, and
     * not a word spoken. Hence the second attempt without it, so a key naming
     * a voice somebody removed is still heard.
     */
    if (request.voice) {
      const asked = `<voice required="Name=${escapeXml(request.voice)}"/>${escapeXml(text)}`;
      const result = call(self, SLOT.speak, SPEAK_ARGS, [asked, flags | SPF.isXml, null]);
      if (result === 0) return;
    }

    // Not XML, deliberately: nothing anybody typed on a key should be able to
    // become markup, and without a voice to ask for there is nothing to gain.
    call(self, SLOT.speak, SPEAK_ARGS, [text, flags | SPF.notXml, null]);
  } catch {
    // A phrase that will not come out is not a reason for the key to fail: the
    // press did what it was for, and this was the announcement of it.
  }
}

const SPEAK_ARGS = ['char16_t *', 'uint32', 'void *'] as const;

/**
 * Cuts off what is being said and throws away what was queued.
 *
 * An empty phrase with the purge flag, which is how SAPI is told to stop: it
 * has nothing to say afterwards, and the purge happens first.
 */
export async function stop(): Promise<void> {
  const self = await open();
  if (!self) return;

  try {
    call(self, SLOT.speak, SPEAK_ARGS, ['', SPF.async | SPF.purge | SPF.notXml, null]);
  } catch {
    // Silence that will not stop is not worth a failed key either.
  }
}

/** Lets go of the voice, for a daemon shutting down. */
export function closeSpeech(): void {
  release(voice);
  voice = undefined;
  opened = false;
}

/**
 * Every installed voice, as Windows describes them.
 *
 * The one thing still done through PowerShell, and the one place it is
 * harmless: enumerating voice tokens means three more COM interfaces whose
 * vtables would have to be verified, this is asked once when somebody opens a
 * field rather than on a key press, and no text of anybody's goes into it —
 * so there is nothing here to escape and nothing to inject into.
 */
export async function listVoices(): Promise<string[]> {
  if (!speechAvailable()) return [];

  const script = '(New-Object -ComObject SAPI.SpVoice).GetVoices() | ForEach-Object { $_.GetDescription() }';

  return new Promise((resolve) => {
    const child = execFile(
      'powershell',
      // UTF-16LE base64, so no console code page is involved: the same trap
      // that made a Russian phrase come out as mojibake would make a Russian
      // voice description unmatchable.
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 5_000, encoding: 'utf8' },
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
  });
}

/**
 * The five characters XML cares about.
 *
 * Only ever applied to text on its way into SAPI's markup, and only when a
 * voice has been named. The worst a mistake here could do is a phrase that
 * will not parse — there is no shell on the other side any more — but a `<`
 * in somebody's label should still be read out rather than swallowed.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clamp(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}
