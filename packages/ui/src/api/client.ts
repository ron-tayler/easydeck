import type { ApiEvent, EventMessage } from '@easydeck/protocol';

import { createIpcTransport, isRunningInApp } from './ipc-transport.js';
import { createWebSocketTransport } from './websocket-transport.js';
import { TransportError } from './transport.js';
import type { Transport } from './transport.js';

/**
 * The protocol, as the UI uses it.
 *
 * Turns request/response plumbing into plain method calls that either return
 * a result or throw, so components never handle envelopes.
 */
export class DeckClient {
  private nextId = 1;

  constructor(private readonly transport: Transport) {}

  get kind(): Transport['kind'] {
    return this.transport.kind;
  }

  async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.transport.send({
      type: 'request',
      id: String(this.nextId++),
      method,
      params,
    });

    if (!response.ok) {
      throw new TransportError(response.error?.message ?? `${method} failed`);
    }
    return response.result as T;
  }

  on(event: ApiEvent, listener: (payload: unknown) => void): () => void {
    return this.transport.onEvent((message: EventMessage) => {
      if (message.event === event) listener(message.payload);
    });
  }

  onConnected(listener: (connected: boolean) => void): () => void {
    return this.transport.onConnected(listener);
  }

  close(): void {
    this.transport.close();
  }
}

/**
 * Picks a transport for wherever the UI happens to be running.
 *
 * Inside the desktop app the preload bridge is present and IPC wins; in a
 * browser the token comes from the query string, which is how the app will
 * hand it over when it opens the configurator externally.
 */
export function createClient(): DeckClient {
  if (isRunningInApp()) return new DeckClient(createIpcTransport());

  const params = new URLSearchParams(window.location.search);
  const port = Number(params.get('port') ?? '') || undefined;

  /*
   * In deck mode the page is not the configurator but a deck in its own right,
   * and it authenticates as a device: an identity it keeps, and a token the
   * daemon gives it once a human has approved it by sight.
   */
  if (!isRunningInApp()) {
    return new DeckClient(
      createWebSocketTransport({
        token: deviceToken() ?? '',
        deviceId: deviceId(),
        deviceName: deviceName(),
        ...(port === undefined ? {} : { port }),
      }),
    );
  }

  const token = params.get('token') ?? '';
  return new DeckClient(createWebSocketTransport({ token, ...(port === undefined ? {} : { port }) }));
}


const DEVICE_ID_KEY = 'easydeck.deviceId';
const DEVICE_TOKEN_KEY = 'easydeck.deviceToken';
const DEVICE_NAME_KEY = 'easydeck.deviceName';

/**
 * Whether this page is a deck rather than the configurator.
 *
 * Asked of the daemon, not read from the URL. A mode taken from the query
 * string is a mode anyone can choose, and the configurator edits profiles and
 * launches programs — so what a served page may be is the daemon's decision,
 * and over the network the answer is always "a deck".
 *
 * Inside the desktop app there is nothing to ask: the window loads from disk
 * and talks over IPC, and it is the configurator.
 */
export async function resolveMode(): Promise<'deck' | 'configurator'> {
  if (isRunningInApp()) return 'configurator';

  try {
    const response = await fetch('/app-mode');
    const body = (await response.json()) as { mode?: string };
    return body.mode === 'configurator' ? 'configurator' : 'deck';
  } catch {
    // Served by something that is not this daemon, or offline: a deck is the
    // safe answer, since it can do nothing until a person approves it.
    return 'deck';
  }
}

/**
 * Storage that never throws.
 *
 * A tablet may be in private mode, or refusing storage for a plain-HTTP page.
 * Losing the saved identity means asking to be approved again, which is a
 * nuisance; throwing means the page does not start at all, which looks like a
 * broken program.
 */
function remembered(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to be done, and nothing worth stopping for.
  }
}

/**
 * A random identifier, without requiring a secure context.
 *
 * `crypto.randomUUID` exists only on HTTPS and on localhost — and a tablet
 * reaches this daemon at a plain `http://192.168.…`, where it is simply
 * absent. Calling it there threw before anything rendered, which is why the
 * page showed its background and nothing else.
 */
function randomId(): string {
  const bytes = new Uint8Array(16);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Not cryptography: this only has to be unlikely to collide with the
    // handful of devices one person owns.
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** This device's lasting identity, made once and kept. */
export function deviceId(): string {
  const stored = remembered(DEVICE_ID_KEY);
  if (stored) return stored;

  const id = randomId();
  remember(DEVICE_ID_KEY, id);
  return id;
}

export function deviceName(): string {
  return remembered(DEVICE_NAME_KEY) ?? navigator.platform ?? 'Device';
}

export function setDeviceName(name: string): void {
  remember(DEVICE_NAME_KEY, name);
}

export function deviceToken(): string | undefined {
  return remembered(DEVICE_TOKEN_KEY);
}

export function rememberDeviceToken(token: string): void {
  remember(DEVICE_TOKEN_KEY, token);
}

/**
 * Starts over as a device nobody has seen.
 *
 * For the one case the daemon cannot resolve: this page claims an identity
 * that is already approved but cannot prove it owns it — storage was cleared,
 * or the page is in a private tab. Rather than queue forever behind a request
 * that can never be completed, it becomes somebody new and asks again.
 */
export function forgetDeviceIdentity(): void {
  remember(DEVICE_ID_KEY, randomId());
  try {
    localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
