/**
 * Layout-independent text injection on Windows.
 *
 * The cross-platform backend types by translating each character into the key
 * that would produce it, then pressing that key — so "hello" typed while a
 * Russian layout is active arrives as "руддщ". The receiving application maps
 * the virtual key through *its* layout, and nothing downstream can undo that.
 *
 * `SendInput` with `KEYEVENTF_UNICODE` carries the character itself instead of
 * a key: Windows delivers it as `VK_PACKET`, no layout is consulted, and no
 * Shift is needed for capitals. It also types characters the active layout has
 * no key for at all, which the key-pressing path simply cannot do.
 *
 * Measured rather than assumed: a low-level keyboard hook shows the old path
 * emitting `vk=0x48 (H)` and the new one `vk=0xE7 scan=0x0068`.
 */

/** Only the sliver of koffi this module uses. */
interface Koffi {
  struct(name: string, fields: Record<string, string>): unknown;
  pointer(type: unknown): unknown;
  sizeof(type: unknown): number;
  load(library: string): {
    func(
      convention: string,
      name: string,
      result: string,
      params: readonly unknown[],
    ): (...args: readonly unknown[]) => number;
  };
}

const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_UNICODE = 0x0004;

const VK_RETURN = 0x0d;
const VK_TAB = 0x09;

/**
 * `INPUT` flattened to its keyboard arm, with the union's padding written out.
 *
 * `type` is followed by four bytes of alignment padding, and the union is as
 * wide as its mouse arm — hence the tail. Getting this wrong does not crash;
 * it silently types nothing, so the size is asserted below rather than
 * trusted.
 */
const INPUT_FIELDS: Record<string, string> = {
  type: 'uint32',
  _pad: 'uint32',
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  _pad2: 'uint32',
  dwExtraInfo: 'uintptr',
  _tail: 'uint64',
};

const INPUT_SIZE = 40;

/** Sent in one call rather than one per character: fewer boundaries for an
    application to drop input on, and no pacing to tune. */
const CHUNK = 128;

interface KeyEvent {
  readonly type: number;
  readonly _pad: number;
  readonly wVk: number;
  readonly wScan: number;
  readonly dwFlags: number;
  readonly time: number;
  readonly _pad2: number;
  readonly dwExtraInfo: number;
  readonly _tail: bigint;
}

export interface UnicodeTyper {
  type(text: string): void;
}

let cached: UnicodeTyper | null | undefined;

/**
 * Builds the typer, or returns null when this platform or build cannot have
 * one — the caller then falls back to the cross-platform backend.
 */
export async function loadUnicodeTyper(): Promise<UnicodeTyper | null> {
  if (cached !== undefined) return cached;
  cached = process.platform === 'win32' ? await build() : null;
  return cached;
}

async function build(): Promise<UnicodeTyper | null> {
  try {
    const koffi = ((await import('koffi')) as unknown as { default: Koffi }).default;

    const INPUT = koffi.struct('EasyDeckInput', INPUT_FIELDS);
    const size = koffi.sizeof(INPUT);
    if (size !== INPUT_SIZE) {
      // A mismatch means the struct no longer matches the ABI, and SendInput
      // would reject every call without saying why. Fall back instead.
      return null;
    }

    const sendInput = koffi
      .load('user32.dll')
      .func('__stdcall', 'SendInput', 'uint32', ['uint32', koffi.pointer(INPUT), 'int32']);

    return {
      type(text: string): void {
        const events = toEvents(text);
        for (let at = 0; at < events.length; at += CHUNK) {
          const batch = events.slice(at, at + CHUNK);
          sendInput(batch.length, batch, size);
        }
      },
    };
  } catch {
    return null;
  }
}

function event(vk: number, scan: number, flags: number): KeyEvent {
  return {
    type: INPUT_KEYBOARD,
    _pad: 0,
    wVk: vk,
    wScan: scan,
    dwFlags: flags,
    time: 0,
    _pad2: 0,
    dwExtraInfo: 0,
    _tail: 0n,
  };
}

/**
 * Iterates UTF-16 code units, not code points: a surrogate pair is delivered
 * as two consecutive unicode events, which is exactly what Windows expects.
 */
function toEvents(text: string): KeyEvent[] {
  const events: KeyEvent[] = [];

  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);

    // Enter and Tab have no unicode form an application will act on: pasted
    // as characters they land as literal control codes, or as nothing.
    if (code === 0x0a) {
      events.push(event(VK_RETURN, 0, 0), event(VK_RETURN, 0, KEYEVENTF_KEYUP));
      continue;
    }
    if (code === 0x0d) continue; // CRLF: the LF above already sent Enter.
    if (code === 0x09) {
      events.push(event(VK_TAB, 0, 0), event(VK_TAB, 0, KEYEVENTF_KEYUP));
      continue;
    }

    events.push(
      event(0, code, KEYEVENTF_UNICODE),
      event(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP),
    );
  }

  return events;
}
