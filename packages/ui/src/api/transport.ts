import type { EventMessage, RequestMessage, ResponseMessage } from '@easydeck/protocol';

/**
 * How the UI reaches the deck.
 *
 * Two implementations exist — Electron IPC and a browser WebSocket — and this
 * is the only file that knows the difference. The protocol above it is
 * identical either way, which is what lets the same configurator run inside
 * the desktop window and in a plain browser tab.
 */
export interface Transport {
  readonly kind: 'ipc' | 'websocket';
  send(message: RequestMessage): Promise<ResponseMessage>;
  /** Subscribes to server-pushed events. Returns an unsubscribe function. */
  onEvent(listener: (message: EventMessage) => void): () => void;
  /** Subscribes to connectivity changes. Returns an unsubscribe function. */
  onConnected(listener: (connected: boolean) => void): () => void;
  close(): void;
}

export class TransportError extends Error {}
