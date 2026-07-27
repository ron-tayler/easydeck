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
  const url = `ws://${options.host ?? '127.0.0.1'}:${options.port ?? DEFAULT_PORT}/?token=${encodeURIComponent(options.token)}`;

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
