import { basename } from 'node:path';

import {
  KOFFI,
  call,
  create,
  guid,
  invoke,
  loadCom,
  queryInterface,
  readString,
  release,
  takeString,
} from './win32-com.js';
import type { ComPointer } from './win32-com.js';

/**
 * Sound devices and per-application volume, through Windows Core Audio.
 *
 * Three things a streamer does by hand a dozen times a night and one at a
 * time: change which headphones everything comes out of, turn the game down
 * without turning the call down, and stop one program shouting over the rest.
 *
 * Two of the three are documented interfaces. Making a device the default one
 * is not: `IPolicyConfig` has never been published, and every program that
 * does this — including the ones people already use — calls it anyway. Its
 * layout has been stable since Windows 7, and there is no supported
 * alternative: the control panel is the only sanctioned way, which is exactly
 * what a deck exists to avoid.
 */

// --- what COM calls things ------------------------------------------------

const CLSID_MMDeviceEnumerator = guid('BCDE0395-E52F-467C-8E3D-C4579291692E');
const IID_IMMDeviceEnumerator = guid('A95664D2-9614-4F35-A746-DE8DB63617E6');
const IID_IAudioSessionManager2 = guid('77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F');
const IID_IAudioSessionControl2 = guid('BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D');
const IID_ISimpleAudioVolume = guid('87CE5498-68D6-44E5-9215-6DA47EF883D8');
const CLSID_PolicyConfigClient = guid('870AF99C-171D-4F9E-AF0D-E63DF40C2BC9');
const IID_IPolicyConfig = guid('F8679F50-850A-41CF-9C72-430F290290C8');

/** `PKEY_Device_FriendlyName`: what the sound settings show for a device. */
const PKEY_DEVICE_FRIENDLY_NAME = propertyKey('A45C254E-DF1C-4EFD-8020-67D146A850E0', 14);

/** Vtable slots. Counting starts at three, where `IUnknown` leaves off. */
const ENUM_AUDIO_ENDPOINTS = 3;
const GET_DEFAULT_ENDPOINT = 4;
const COLLECTION_GET_COUNT = 3;
const COLLECTION_ITEM = 4;
const DEVICE_ACTIVATE = 3;
const DEVICE_OPEN_PROPERTY_STORE = 4;
const DEVICE_GET_ID = 5;
const STORE_GET_VALUE = 5;
const MANAGER_GET_SESSION_ENUMERATOR = 5;
const SESSIONS_GET_COUNT = 3;
const SESSIONS_GET_SESSION = 4;
const SESSION_GET_PROCESS_ID = 14;
const VOLUME_SET_MASTER = 3;
const VOLUME_GET_MASTER = 4;
const VOLUME_SET_MUTE = 5;
const VOLUME_GET_MUTE = 6;
/** `IPolicyConfig::SetDefaultEndpoint`, eleventh of its own methods. */
const POLICY_SET_DEFAULT_ENDPOINT = 13;

const DEVICE_STATE_ACTIVE = 1;
const STGM_READ = 0;
const CLSCTX_ALL = 23;

/** `VT_LPWSTR`, which is what a device's name comes back as. */
const VT_LPWSTR = 31;

export type AudioDirection = 'output' | 'input';

/**
 * Which default is being set.
 *
 * Windows keeps two, and the sound settings show them as one list with a
 * second choice hidden in a dropdown: everything ordinary follows `default`,
 * while Teams, Discord and the like follow `communications`. Setting the first
 * writes both console and multimedia, which is what "make this the default"
 * means to a person.
 */
export type AudioRole = 'default' | 'communications';

export interface AudioDevice {
  readonly id: string;
  readonly name: string;
  readonly direction: AudioDirection;
  readonly isDefault: boolean;
  readonly isDefaultCommunications: boolean;
}

export interface AudioSession {
  /** The process, which is how a person names an application. */
  readonly processId: number;
  /** `discord.exe`, `chrome.exe` — the file name, lowercased. */
  readonly process: string;
  readonly volume: number;
  readonly muted: boolean;
}

const dataFlow = (direction: AudioDirection): number => (direction === 'output' ? 0 : 1);

/** `eConsole`, `eMultimedia`, `eCommunications`. */
const ROLES: Readonly<Record<AudioRole, readonly number[]>> = {
  default: [0, 1],
  communications: [2],
};

/** Whether this machine can do any of it. */
export async function audioAvailable(): Promise<boolean> {
  return loadCom();
}

// --- devices --------------------------------------------------------------

export async function listDevices(direction: AudioDirection): Promise<AudioDevice[]> {
  if (!(await loadCom())) return [];

  const enumerator = create(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator, 'The audio device list');

  try {
    const defaults = {
      normal: defaultDeviceId(enumerator, direction, 0),
      communications: defaultDeviceId(enumerator, direction, 2),
    };

    const collectionOut: unknown[] = [null];
    invoke(
      enumerator,
      ENUM_AUDIO_ENDPOINTS,
      ['int', 'uint32', KOFFI.out(KOFFI.pointer('void *'))],
      [dataFlow(direction), DEVICE_STATE_ACTIVE, collectionOut],
      'Listing audio devices',
    );

    const collection = collectionOut[0];
    if (!collection) return [];

    try {
      const countOut: unknown[] = [0];
      invoke(
        collection,
        COLLECTION_GET_COUNT,
        [KOFFI.out(KOFFI.pointer('uint32'))],
        [countOut],
        'Counting audio devices',
      );

      const devices: AudioDevice[] = [];
      for (let index = 0; index < Number(countOut[0] ?? 0); index += 1) {
        const deviceOut: unknown[] = [null];
        invoke(
          collection,
          COLLECTION_ITEM,
          ['uint32', KOFFI.out(KOFFI.pointer('void *'))],
          [index, deviceOut],
          'Reading an audio device',
        );

        const device = deviceOut[0];
        if (!device) continue;

        try {
          const id = deviceId(device);
          devices.push({
            id,
            name: deviceName(device) || id,
            direction,
            isDefault: id === defaults.normal,
            isDefaultCommunications: id === defaults.communications,
          });
        } finally {
          release(device);
        }
      }

      return devices;
    } finally {
      release(collection);
    }
  } finally {
    release(enumerator);
  }
}

/**
 * Makes a device the one everything uses, or the one calls use.
 *
 * Both console and multimedia are written for the ordinary default: Windows
 * keeps them apart, nothing in the sound settings shows the difference, and a
 * deck that set one of them would leave the machine in a state its own control
 * panel cannot describe.
 */
export async function setDefaultDevice(deviceId: string, role: AudioRole): Promise<void> {
  if (!(await loadCom())) throw new Error('Sound devices are only available on Windows');

  const policy = create(CLSID_PolicyConfigClient, IID_IPolicyConfig, 'The sound policy');

  try {
    for (const value of ROLES[role]) {
      invoke(
        policy,
        POLICY_SET_DEFAULT_ENDPOINT,
        ['char16_t *', 'int'],
        [deviceId, value],
        'Setting the default sound device',
      );
    }
  } finally {
    release(policy);
  }
}

function defaultDeviceId(enumerator: ComPointer, direction: AudioDirection, role: number): string {
  const out: unknown[] = [null];

  // Not `invoke`: a machine with no default of that kind answers with an
  // error, and "there is none" is an answer rather than a failure.
  const result = call(
    enumerator,
    GET_DEFAULT_ENDPOINT,
    ['int', 'int', KOFFI.out(KOFFI.pointer('void *'))],
    [dataFlow(direction), role, out],
  );

  if (result !== 0 || !out[0]) return '';

  try {
    return deviceId(out[0]);
  } finally {
    release(out[0]);
  }
}

function deviceId(device: ComPointer): string {
  const out: unknown[] = [null];
  invoke(device, DEVICE_GET_ID, [KOFFI.out(KOFFI.pointer('void *'))], [out], 'Reading a device id');
  return takeString(out[0]);
}

/**
 * The name the sound settings show, out of the device's property store.
 *
 * A `PROPVARIANT` is a tagged union twenty-four bytes wide; the tag is the
 * first two, and a string's pointer sits at offset eight. Read rather than
 * modelled, because this is the only property this program ever asks for.
 */
function deviceName(device: ComPointer): string {
  const storeOut: unknown[] = [null];

  const opened = call(
    device,
    DEVICE_OPEN_PROPERTY_STORE,
    ['uint32', KOFFI.out(KOFFI.pointer('void *'))],
    [STGM_READ, storeOut],
  );
  if (opened !== 0 || !storeOut[0]) return '';

  const store = storeOut[0];
  try {
    const variant = Buffer.alloc(24);
    const read = call(store, STORE_GET_VALUE, ['void *', 'void *'], [PKEY_DEVICE_FRIENDLY_NAME, variant]);
    if (read !== 0 || variant.readUInt16LE(0) !== VT_LPWSTR) return '';

    const address = variant.readBigUInt64LE(8);
    if (address === 0n) return '';

    return readString(KOFFI.decode(variant, 8, 'void *'));
  } finally {
    release(store);
  }
}

/** A `PROPERTYKEY`: a GUID and the number of the property inside it. */
function propertyKey(fmtid: string, pid: number): Buffer {
  const key = Buffer.alloc(20);
  guid(fmtid).copy(key, 0);
  key.writeUInt32LE(pid, 16);
  return key;
}

// --- what each application is doing ---------------------------------------

/**
 * Every program currently playing something, with its own volume.
 *
 * A session belongs to a device, so this asks the default output — which is
 * what somebody means by "turn Discord down" without saying where.
 */
export async function listSessions(): Promise<AudioSession[]> {
  if (!(await loadCom())) return [];

  const enumerator = create(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator, 'The audio device list');

  try {
    const deviceOut: unknown[] = [null];
    const gotDevice = call(
      enumerator,
      GET_DEFAULT_ENDPOINT,
      ['int', 'int', KOFFI.out(KOFFI.pointer('void *'))],
      [0, 0, deviceOut],
    );
    if (gotDevice !== 0 || !deviceOut[0]) return [];

    const device = deviceOut[0];
    try {
      return sessionsOf(device);
    } finally {
      release(device);
    }
  } finally {
    release(enumerator);
  }
}

function sessionsOf(device: ComPointer): AudioSession[] {
  const managerOut: unknown[] = [null];
  invoke(
    device,
    DEVICE_ACTIVATE,
    ['void *', 'uint32', 'void *', KOFFI.out(KOFFI.pointer('void *'))],
    [IID_IAudioSessionManager2, CLSCTX_ALL, null, managerOut],
    'Opening the session manager',
  );

  const manager = managerOut[0];
  if (!manager) return [];

  try {
    const listOut: unknown[] = [null];
    invoke(
      manager,
      MANAGER_GET_SESSION_ENUMERATOR,
      [KOFFI.out(KOFFI.pointer('void *'))],
      [listOut],
      'Listing sessions',
    );

    const list = listOut[0];
    if (!list) return [];

    try {
      const countOut: unknown[] = [0];
      invoke(list, SESSIONS_GET_COUNT, [KOFFI.out(KOFFI.pointer('int'))], [countOut], 'Counting sessions');

      const sessions: AudioSession[] = [];
      for (let index = 0; index < Number(countOut[0] ?? 0); index += 1) {
        const sessionOut: unknown[] = [null];
        const got = call(
          list,
          SESSIONS_GET_SESSION,
          ['int', KOFFI.out(KOFFI.pointer('void *'))],
          [index, sessionOut],
        );
        if (got !== 0 || !sessionOut[0]) continue;

        const session = sessionOut[0];
        try {
          const found = describeSession(session);
          if (found) sessions.push(found);
        } finally {
          release(session);
        }
      }

      return sessions;
    } finally {
      release(list);
    }
  } finally {
    release(manager);
  }
}

function describeSession(session: ComPointer): AudioSession | undefined {
  let control: ComPointer | undefined;
  let volume: ComPointer | undefined;

  try {
    control = queryInterface(session, IID_IAudioSessionControl2, 'the session');
    volume = queryInterface(session, IID_ISimpleAudioVolume, "the session's volume");

    const pidOut: unknown[] = [0];
    if (call(control, SESSION_GET_PROCESS_ID, [KOFFI.out(KOFFI.pointer('uint32'))], [pidOut]) !== 0) {
      return undefined;
    }

    const processId = Number(pidOut[0] ?? 0);
    // The system sounds session has no process of its own, and nothing useful
    // can be said about it in a list somebody picks an application from.
    if (processId === 0) return undefined;

    const levelOut: unknown[] = [0];
    call(volume, VOLUME_GET_MASTER, [KOFFI.out(KOFFI.pointer('float'))], [levelOut]);

    const mutedOut: unknown[] = [0];
    call(volume, VOLUME_GET_MUTE, [KOFFI.out(KOFFI.pointer('int'))], [mutedOut]);

    return {
      processId,
      process: processName(processId),
      volume: Math.round(Number(levelOut[0] ?? 0) * 100),
      muted: Number(mutedOut[0] ?? 0) !== 0,
    };
  } catch {
    // A session that went away between being listed and being read, which
    // happens whenever a program is closing.
    return undefined;
  } finally {
    release(control);
    release(volume);
  }
}

/**
 * Changes one application's volume, by the name of its process.
 *
 * Every session of that process is set, because a program may hold several —
 * a browser has one per tab making noise — and turning down one of them is
 * indistinguishable from the action not working.
 */
export async function setSessionVolume(
  process: string,
  change: { readonly set?: number; readonly by?: number; readonly mute?: 'on' | 'off' | 'toggle' },
): Promise<number> {
  if (!(await loadCom())) throw new Error('Sound devices are only available on Windows');

  const wanted = process.trim().toLowerCase();
  const enumerator = create(CLSID_MMDeviceEnumerator, IID_IMMDeviceEnumerator, 'The audio device list');
  let touched = 0;

  try {
    const deviceOut: unknown[] = [null];
    if (
      call(
        enumerator,
        GET_DEFAULT_ENDPOINT,
        ['int', 'int', KOFFI.out(KOFFI.pointer('void *'))],
        [0, 0, deviceOut],
      ) !== 0 ||
      !deviceOut[0]
    ) {
      throw new Error('There is no default sound device to work with');
    }

    const device = deviceOut[0];
    try {
      touched = applyToSessions(device, wanted, change);
    } finally {
      release(device);
    }
  } finally {
    release(enumerator);
  }

  if (touched === 0) {
    throw new Error(`'${process}' is not playing anything right now`);
  }

  return touched;
}

function applyToSessions(
  device: ComPointer,
  wanted: string,
  change: { readonly set?: number; readonly by?: number; readonly mute?: 'on' | 'off' | 'toggle' },
): number {
  const managerOut: unknown[] = [null];
  invoke(
    device,
    DEVICE_ACTIVATE,
    ['void *', 'uint32', 'void *', KOFFI.out(KOFFI.pointer('void *'))],
    [IID_IAudioSessionManager2, CLSCTX_ALL, null, managerOut],
    'Opening the session manager',
  );

  const manager = managerOut[0];
  if (!manager) return 0;

  try {
    const listOut: unknown[] = [null];
    invoke(
      manager,
      MANAGER_GET_SESSION_ENUMERATOR,
      [KOFFI.out(KOFFI.pointer('void *'))],
      [listOut],
      'Listing sessions',
    );

    const list = listOut[0];
    if (!list) return 0;

    let touched = 0;
    try {
      const countOut: unknown[] = [0];
      invoke(list, SESSIONS_GET_COUNT, [KOFFI.out(KOFFI.pointer('int'))], [countOut], 'Counting sessions');

      for (let index = 0; index < Number(countOut[0] ?? 0); index += 1) {
        const sessionOut: unknown[] = [null];
        if (
          call(list, SESSIONS_GET_SESSION, ['int', KOFFI.out(KOFFI.pointer('void *'))], [index, sessionOut]) !==
          0
        ) {
          continue;
        }

        const session = sessionOut[0];
        if (!session) continue;

        try {
          if (applyToSession(session, wanted, change)) touched += 1;
        } finally {
          release(session);
        }
      }
    } finally {
      release(list);
    }

    return touched;
  } finally {
    release(manager);
  }
}

function applyToSession(
  session: ComPointer,
  wanted: string,
  change: { readonly set?: number; readonly by?: number; readonly mute?: 'on' | 'off' | 'toggle' },
): boolean {
  let control: ComPointer | undefined;
  let volume: ComPointer | undefined;

  try {
    control = queryInterface(session, IID_IAudioSessionControl2, 'the session');

    const pidOut: unknown[] = [0];
    if (call(control, SESSION_GET_PROCESS_ID, [KOFFI.out(KOFFI.pointer('uint32'))], [pidOut]) !== 0) {
      return false;
    }

    const processId = Number(pidOut[0] ?? 0);
    if (processId === 0 || processName(processId) !== wanted) return false;

    volume = queryInterface(session, IID_ISimpleAudioVolume, "the session's volume");

    if (change.mute !== undefined) {
      const mutedOut: unknown[] = [0];
      call(volume, VOLUME_GET_MUTE, [KOFFI.out(KOFFI.pointer('int'))], [mutedOut]);
      const muted = Number(mutedOut[0] ?? 0) !== 0;
      const next = change.mute === 'toggle' ? !muted : change.mute === 'on';

      invoke(volume, VOLUME_SET_MUTE, ['int', 'void *'], [next ? 1 : 0, null], 'Muting an application');
      return true;
    }

    const levelOut: unknown[] = [0];
    call(volume, VOLUME_GET_MASTER, [KOFFI.out(KOFFI.pointer('float'))], [levelOut]);
    const current = Number(levelOut[0] ?? 0);

    const target = change.set !== undefined ? change.set / 100 : current + (change.by ?? 0) / 100;
    const clamped = Math.min(1, Math.max(0, target));

    invoke(volume, VOLUME_SET_MASTER, ['float', 'void *'], [clamped, null], "Setting an application's volume");
    return true;
  } catch {
    return false;
  } finally {
    release(control);
    release(volume);
  }
}

// --- which device one application uses ------------------------------------

/**
 * The per-application output Windows 11 shows in its sound settings.
 *
 * Reached through `IAudioPolicyConfigFactory`, which is not documented,
 * activated through WinRT and shaped differently on Windows 10 and 11. Two
 * things keep that from being reckless.
 *
 * The interface is asked for by id, so a Windows that does not have the shape
 * we are about to call refuses at the door rather than letting us call the
 * wrong slot — and calling the wrong slot of a COM object is not a failed
 * action, it is a process that stops existing.
 *
 * And the slot is only ever used with the id it belongs to: `SetPersisted…` is
 * the twentieth method on Windows 11 and the nineteenth on Windows 10, which
 * is the whole reason both are listed rather than one being guessed at.
 */
const POLICY_VARIANTS = [
  { iid: guid('AB3D4648-E242-459F-B02F-541C70306324'), set: 25, get: 26, name: 'Windows 11' },
  { iid: guid('2A59116D-6C4F-45E0-A74F-707E3FEF9258'), set: 24, get: 25, name: 'Windows 10' },
] as const;

/*
 * Where those numbers come from, since getting them wrong is not a failed
 * call but a process that stops existing.
 *
 * This is a WinRT activation factory, so it descends from `IInspectable` and
 * its own methods begin at slot six rather than three. That was established by
 * asking the factory for `GetTrustLevel` — slot five — and getting an answer:
 * the first attempt assumed three, called nineteen slots past where the
 * interface ended, and took the probe down with it.
 *
 * `SetPersistedDefaultAudioEndpoint` is the twentieth method on Windows 11 and
 * the nineteenth on Windows 10, hence 6+19 and 6+18.
 */

/** Device interface classes, which a per-application id is built out of. */
const DEVINTERFACE_AUDIO_RENDER = '{e6327cad-dcec-4949-ae8a-991e976a79d2}';
const DEVINTERFACE_AUDIO_CAPTURE = '{2eef81be-33fa-4800-9670-1cd474972c3f}';

/**
 * The id this interface wants, which is not the one everything else uses.
 *
 * An endpoint id names the device; this names the *interface* to it, and
 * nothing accepts the plain form. An empty string is meaningful and is passed
 * through: it means "whatever the system default is", which is how an
 * application is put back the way it was.
 */
export function perApplicationId(endpointId: string, direction: AudioDirection): string {
  if (endpointId === '') return '';

  const kind = direction === 'output' ? DEVINTERFACE_AUDIO_RENDER : DEVINTERFACE_AUDIO_CAPTURE;
  return `\\\\?\\SWD#MMDEVAPI#${endpointId}#${kind}`;
}

interface PolicyFactory {
  readonly factory: ComPointer;
  readonly variant: (typeof POLICY_VARIANTS)[number];
}

function activationFactory(): PolicyFactory | undefined {
  const combase = KOFFI.load('combase.dll');

  const createString = combase.func('__stdcall', 'WindowsCreateString', 'int', [
    'char16_t *',
    'uint32',
    KOFFI.out(KOFFI.pointer('void *')),
  ]);
  const deleteString = combase.func('__stdcall', 'WindowsDeleteString', 'int', ['void *']);
  const getFactory = combase.func('__stdcall', 'RoGetActivationFactory', 'int', [
    'void *',
    'void *',
    KOFFI.out(KOFFI.pointer('void *')),
  ]);

  const className = 'Windows.Media.Internal.AudioPolicyConfig';
  const nameOut: unknown[] = [null];
  if (createString(className, className.length, nameOut) !== 0 || !nameOut[0]) return undefined;

  try {
    for (const variant of POLICY_VARIANTS) {
      const out: unknown[] = [null];
      if (getFactory(nameOut[0], variant.iid, out) === 0 && out[0]) {
        return { factory: out[0], variant };
      }
    }
  } finally {
    deleteString(nameOut[0]);
  }

  return undefined;
}

/** Whether this Windows offers per-application routing at all. */
export async function appRoutingAvailable(): Promise<string | undefined> {
  if (!(await loadCom())) return undefined;

  const found = activationFactory();
  if (!found) return undefined;

  try {
    return found.variant.name;
  } finally {
    release(found.factory);
  }
}

/** Which device an application is pinned to, or '' for the system default. */
export async function getAppDevice(processId: number, direction: AudioDirection): Promise<string> {
  if (!(await loadCom())) return '';

  const found = activationFactory();
  if (!found) return '';

  try {
    const out: unknown[] = [null];
    const result = call(
      found.factory,
      found.variant.get,
      ['uint32', 'int', 'int', KOFFI.out(KOFFI.pointer('void *'))],
      [processId, dataFlow(direction), 0, out],
    );

    if (result !== 0 || !out[0]) return '';
    return readHString(out[0]);
  } finally {
    release(found.factory);
  }
}

/**
 * Sends every session of a program to a chosen device.
 *
 * All three roles are written, because the sound settings show one choice per
 * application and a deck that set one of them would leave a state its own
 * control panel cannot describe — the same reason the machine-wide default
 * writes two.
 */
export async function setAppDevice(
  process: string,
  endpointId: string,
  direction: AudioDirection,
): Promise<number> {
  if (!(await loadCom())) throw new Error('Sound devices are only available on Windows');

  const found = activationFactory();
  if (!found) {
    throw new Error('This version of Windows cannot route a single application');
  }

  const combase = KOFFI.load('combase.dll');
  const createString = combase.func('__stdcall', 'WindowsCreateString', 'int', [
    'char16_t *',
    'uint32',
    KOFFI.out(KOFFI.pointer('void *')),
  ]);
  const deleteString = combase.func('__stdcall', 'WindowsDeleteString', 'int', ['void *']);

  const wanted = process.trim().toLowerCase();
  const target = perApplicationId(endpointId, direction);

  const idOut: unknown[] = [null];
  if (createString(target, target.length, idOut) !== 0) {
    release(found.factory);
    throw new Error('Could not name the device for Windows');
  }

  try {
    const sessions = (await listSessions()).filter((session) => session.process === wanted);
    if (sessions.length === 0) throw new Error(`'${process}' is not playing anything right now`);

    for (const session of sessions) {
      for (const role of [0, 1, 2]) {
        invoke(
          found.factory,
          found.variant.set,
          ['uint32', 'int', 'int', 'void *'],
          [session.processId, dataFlow(direction), role, idOut[0]],
          `Sending ${process} to another device`,
        );
      }
    }

    return sessions.length;
  } finally {
    if (idOut[0]) deleteString(idOut[0]);
    release(found.factory);
  }
}

/** An `HSTRING`, which carries its own length rather than ending in a zero. */
function readHString(handle: unknown): string {
  const combase = KOFFI.load('combase.dll');
  const getBuffer = combase.func('__stdcall', 'WindowsGetStringRawBuffer', 'void *', [
    'void *',
    KOFFI.out(KOFFI.pointer('uint32')),
  ]);
  const deleteString = combase.func('__stdcall', 'WindowsDeleteString', 'int', ['void *']);

  const length: unknown[] = [0];
  const buffer = getBuffer(handle, length) as unknown;

  const text = buffer ? readString(buffer) : '';
  deleteString(handle);
  return text;
}

// --- naming a process -----------------------------------------------------

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const names = new Map<number, string>();

/**
 * `discord.exe` from a process id.
 *
 * Cached, because a session list asks about the same handful of processes
 * every time and opening a process handle is the expensive part. A pid is
 * reused eventually, which would make this wrong — but the cache lives for the
 * length of one call to the list, which is far shorter than that.
 */
function processName(processId: number): string {
  const cached = names.get(processId);
  if (cached !== undefined) return cached;

  let name = '';
  try {
    const kernel32 = KOFFI.load('kernel32.dll');
    const openProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']);
    const closeHandle = kernel32.func('__stdcall', 'CloseHandle', 'int', ['void *']);
    /*
     * The size is in *and* out: on the way in it says how much room there is,
     * on the way out how much was used. Declared as out-only it arrived as
     * zero, Windows answered "buffer too small", and every session came back
     * nameless — which looked exactly like a permissions problem.
     */
    const queryName = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'int', [
      'void *',
      'uint32',
      'void *',
      KOFFI.inout(KOFFI.pointer('uint32')),
    ]);

    const handle = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, processId);
    if (handle) {
      try {
        const room = 512;
        const buffer = Buffer.alloc(room * 2);
        const size: unknown[] = [room];

        if (queryName(handle, 0, buffer, size) !== 0) {
          const used = Number(size[0] ?? 0);
          name = basename(buffer.toString('utf16le', 0, used * 2)).toLowerCase();
        }
      } finally {
        closeHandle(handle);
      }
    }
  } catch {
    // A process that ended, or one this account may not look at. Either way it
    // cannot be named, and an unnamed session is simply not offered.
  }

  names.set(processId, name);
  return name;
}

/** Forgets the process names, so a later list is not answered from an old one. */
export function forgetProcessNames(): void {
  names.clear();
}
