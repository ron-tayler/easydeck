import type { ApiEvent, EventMessage } from '@easydeck/core';

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
  const token = params.get('token') ?? '';
  const port = Number(params.get('port') ?? '') || undefined;

  return new DeckClient(createWebSocketTransport({ token, port }));
}
