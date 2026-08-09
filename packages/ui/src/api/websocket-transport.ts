import type { EventMessage, RequestMessage, ResponseMessage, ServerMessage } from '@easydeck/core';

import { TransportError } from './transport.js';
import type { Transport } from './transport.js';

const DEFAULT_PORT = 8317;
const RECONNECT_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface WebSocketTransportOptions {
  readonly token: string;
  readonly host?: string;
  readonly port?: number;
  /**
   * Identifies this device when it has no token yet.
   *
   * A device arrives unknown, waits to be approved by sight, and is then given
   * a token of its own; until that happens this is all the daemon knows it by.
   */
  readonly deviceId?: string;
  readonly deviceName?: string;
}

/**
 * Talks to the core over the WebSocket API, for running the configurator in a
 * plain browser tab.
 *
 * Unlike IPC this really can disconnect — the app may be restarting — so it
 * reconnects on a timer and fails in-flight requests instead of leaving the
 * UI waiting on promises that will never settle.
 */
export function createWebSocketTransport(options: WebSocketTransportOptions): Transport {
  /*
   * Built from the address the page itself came from, not from a hardcoded
   * loopback: a tablet loads the configurator over the network, and the API
   * only accepts connections whose origin matches the host they asked for.
   */
  const query = new URLSearchParams({ token: options.token });
  if (options.deviceId) query.set('device', options.deviceId);
  if (options.deviceName) query.set('name', options.deviceName);

  const host = options.host ?? window.location.hostname ?? '127.0.0.1';
  const port = options.port ?? Number(window.location.port) ?? DEFAULT_PORT;
  const url = `ws://${host}:${port || DEFAULT_PORT}/?${query.toString()}`;

  const eventListeners = new Set<(message: EventMessage) => void>();
  const connectionListeners = new Set<(connected: boolean) => void>();
  const pending = new Map<string, { resolve: (r: ResponseMessage) => void; reject: (e: Error) => void; timer: number }>();

  let socket: WebSocket | undefined;
  let closed = false;
  let reconnectTimer: number | undefined;

  const setConnected = (connected: boolean) => {
    for (const listener of connectionListeners) listener(connected);
  };

  const failPending = (reason: string) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new TransportError(reason));
    }
    pending.clear();
  };

  const connect = () => {
    if (closed) return;

    socket = new WebSocket(url);

    socket.addEventListener('open', () => setConnected(true));

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;

      if (message.type === 'response') {
        const entry = pending.get(message.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(message.id);
        entry.resolve(message);
        return;
      }

      for (const listener of eventListeners) listener(message);
    });

    socket.addEventListener('close', () => {
      setConnected(false);
      failPending('The connection to EasyDeck was lost');
      if (!closed) reconnectTimer = window.setTimeout(connect, RECONNECT_DELAY_MS);
    });

    // 'error' is always followed by 'close', which does the recovery work.
    socket.addEventListener('error', () => undefined);
  };

  connect();

  let nextId = 1;

  return {
    kind: 'websocket',

    send(message: RequestMessage): Promise<ResponseMessage> {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new TransportError('Not connected to EasyDeck'));
      }

      const id = message.id || String(nextId++);
      const outgoing: RequestMessage = { ...message, id };

      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pending.delete(id);
          reject(new TransportError('EasyDeck did not answer in time'));
        }, REQUEST_TIMEOUT_MS);

        pending.set(id, { resolve, reject, timer });
        socket!.send(JSON.stringify(outgoing));
      });
    },

    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },

    onConnected(listener) {
      connectionListeners.add(listener);
      listener(socket?.readyState === WebSocket.OPEN);
      return () => connectionListeners.delete(listener);
    },

    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      failPending('The client was closed');
      socket?.close();
    },
  };
}
