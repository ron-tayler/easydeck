/**
 * Enough COM to talk to Windows' audio stack, and no more.
 *
 * There is no Node binding for Core Audio worth having: the maintained ones
 * stop at "set the master volume", and the rest are unbuilt addons. What there
 * is, already in this program, is koffi — so the interfaces are called the way
 * C++ calls them, through the vtable.
 *
 * That sounds worse than it is. A COM object is a pointer to a pointer to an
 * array of function pointers; a method is its index in that array, counting
 * from three because `IUnknown` takes the first three. Everything below is
 * that one idea, plus the housekeeping COM asks for in return.
 *
 * Windows only, and loaded lazily: a machine without it loses these actions
 * rather than the ability to start.
 */

/** Only the sliver of koffi this module uses. */
interface Koffi {
  load(library: string): {
    func(convention: string, name: string, result: string, params: readonly unknown[]): (...args: readonly unknown[]) => number;
  };
  proto(convention: string, name: string, result: string, params: readonly unknown[]): unknown;
  call(address: unknown, proto: unknown, ...args: readonly unknown[]): number;
  decode(pointer: unknown, offsetOrType: number | string, type?: string | number, length?: number): never;
  pointer(type: unknown): unknown;
  out(type: unknown): unknown;
  inout(type: unknown): unknown;
  sizeof(type: string): number;
  address(pointer: unknown): bigint;
}

let koffi: Koffi | undefined;
let ole32: ReturnType<Koffi['load']> | undefined;
let started = false;

/** `S_OK`. Everything else is a failure worth naming. */
const S_OK = 0;

const CLSCTX_ALL = 23;
const COINIT_APARTMENTTHREADED = 2;

export type ComPointer = unknown;

/** Loads the pieces once; undefined means this is not a Windows that has them. */
export async function loadCom(): Promise<boolean> {
  if (started) return koffi !== undefined;
  started = true;

  if (process.platform !== 'win32') return false;

  try {
    koffi = (await import('koffi')).default as unknown as Koffi;
    ole32 = koffi.load('ole32.dll');
  } catch {
    koffi = undefined;
    return false;
  }

  /*
   * Apartment-threaded, and failure is not fatal.
   *
   * Node may already have initialised the thread — another native module, or
   * an earlier call of ours — and COM answers `RPC_E_CHANGED_MODE` for a
   * second, different initialisation. That is a description of the thread, not
   * an error: the objects below work either way.
   */
  const coInitialize = ole32.func('__stdcall', 'CoInitializeEx', 'int', ['void *', 'uint32']);
  coInitialize(null, COINIT_APARTMENTTHREADED);

  return true;
}

function require_(): { koffi: Koffi; ole32: NonNullable<typeof ole32> } {
  if (!koffi || !ole32) throw new Error('COM is not available on this system');
  return { koffi, ole32 };
}

/** A GUID as the sixteen bytes COM wants, from the form people write down. */
export function guid(text: string): Buffer {
  const clean = text.replace(/[{}-]/g, '');
  if (clean.length !== 32) throw new Error(`'${text}' is not a GUID`);

  const bytes = Buffer.alloc(16);
  bytes.writeUInt32LE(parseInt(clean.slice(0, 8), 16), 0);
  bytes.writeUInt16LE(parseInt(clean.slice(8, 12), 16), 4);
  bytes.writeUInt16LE(parseInt(clean.slice(12, 16), 16), 6);
  for (let index = 0; index < 8; index += 1) {
    bytes[8 + index] = parseInt(clean.slice(16 + index * 2, 18 + index * 2), 16);
  }
  return bytes;
}

let protoCount = 0;

/**
 * Calls a method by its slot in the interface's vtable.
 *
 * Every prototype gets a name of its own because koffi keys them by name, and
 * two signatures under one name is a mismatch that shows up as nonsense rather
 * than as an error.
 */
export function call(
  self: ComPointer,
  slot: number,
  params: readonly unknown[],
  args: readonly unknown[],
): number {
  const { koffi: k } = require_();

  const vtable = k.decode(self, 'void *') as unknown;
  const address = k.decode(vtable, slot * k.sizeof('void *'), 'void *') as unknown;
  const proto = k.proto('__stdcall', `com_${protoCount++}`, 'int', ['void *', ...params]);

  return k.call(address, proto, self, ...args);
}

/** The same, refusing anything COM did not answer `S_OK` to. */
export function invoke(
  self: ComPointer,
  slot: number,
  params: readonly unknown[],
  args: readonly unknown[],
  what: string,
): void {
  const result = call(self, slot, params, args);
  if (result !== S_OK) {
    throw new Error(`${what} failed: 0x${(result >>> 0).toString(16).padStart(8, '0')}`);
  }
}

/** An out-parameter that receives a pointer, and the box to read it out of. */
export function outPointer(): { box: unknown[]; type: unknown } {
  const { koffi: k } = require_();
  return { box: [null], type: k.out(k.pointer('void *')) };
}

export function outValue(type: string): { box: unknown[]; type: unknown } {
  const { koffi: k } = require_();
  return { box: [0], type: k.out(k.pointer(type)) };
}

/** Creates a COM object, the way `CoCreateInstance` does. */
export function create(clsid: Buffer, iid: Buffer, what: string): ComPointer {
  const { koffi: k, ole32: o } = require_();

  const coCreate = o.func('__stdcall', 'CoCreateInstance', 'int', [
    'void *',
    'void *',
    'uint32',
    'void *',
    k.out(k.pointer('void *')),
  ]);

  const out: unknown[] = [null];
  const result = coCreate(clsid, null, CLSCTX_ALL, iid, out);
  if (result !== S_OK || !out[0]) {
    throw new Error(`${what} could not be created: 0x${(result >>> 0).toString(16).padStart(8, '0')}`);
  }

  return out[0];
}

/** `IUnknown::QueryInterface`, which is slot zero. */
export function queryInterface(self: ComPointer, iid: Buffer, what: string): ComPointer {
  const { koffi: k } = require_();
  const out: unknown[] = [null];

  invoke(self, 0, ['void *', k.out(k.pointer('void *'))], [iid, out], `Asking for ${what}`);
  if (!out[0]) throw new Error(`${what} is not available here`);

  return out[0];
}

/**
 * `IUnknown::Release`, which every object wants when you are done with it.
 *
 * Deliberately quiet: releasing is cleanup, and a failure here means a leak
 * rather than a wrong answer. Throwing from it would replace a working action
 * with a broken one to report something nobody can act on.
 */
export function release(self: ComPointer | undefined): void {
  if (!self) return;
  try {
    call(self, 2, [], []);
  } catch {
    // See above.
  }
}

/** A `WCHAR *` COM allocated for us, read and then handed back. */
export function takeString(pointer: unknown): string {
  const { koffi: k, ole32: o } = require_();
  if (!pointer) return '';

  const text = k.decode(pointer, 'char16_t', -1) as unknown as string;
  const free = o.func('__stdcall', 'CoTaskMemFree', 'void', ['void *']);
  free(pointer);

  return text;
}

/** A `WCHAR *` somebody else owns: read, and left alone. */
export function readString(pointer: unknown): string {
  const { koffi: k } = require_();
  if (!pointer) return '';
  return k.decode(pointer, 'char16_t', -1) as unknown as string;
}

export const KOFFI = {
  get out() {
    return require_().koffi.out;
  },
  get inout() {
    return require_().koffi.inout;
  },
  get pointer() {
    return require_().koffi.pointer;
  },
  get decode() {
    return require_().koffi.decode;
  },
  get sizeof() {
    return require_().koffi.sizeof;
  },
  load(library: string) {
    return require_().koffi.load(library);
  },
};
