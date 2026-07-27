import type { EventMessage, RequestMessage, ResponseMessage } from '@easydeck/core';

import type { Transport } from './transport.js';

/** The bridge the desktop app's preload script exposes. */
interface EasyDeckBridge {
  request(message: RequestMessage): Promise<ResponseMessage>;
  getStatus(): Promise<unknown>;
  onStatus(listener: (status: unknown) => void): () => void;
  onEvent(listener: (message: EventMessage) => void): () => void;
}

declare global {
  interface Window {
    easydeck?: EasyDeckBridge;
  }
}

export function isRunningInApp(): boolean {
  return typeof window !== 'undefined' && window.easydeck !== undefined;
}

/**
 * Talks to the core over Electron IPC.
 *
 * There is no connection to lose — the core lives in the same application —
 * so this transport reports connected once and never changes its mind. What
 * can change is whether a *deck* is attached, and that is deck state rather
 * than transport state.
 */
export function createIpcTransport(): Transport {
  const bridge = window.easydeck;
  if (!bridge) throw new Error('The IPC bridge is unavailable outside the desktop app');

  return {
    kind: 'ipc',
    send: (message) => bridge.request(message),
    onEvent: (listener) => bridge.onEvent(listener),
    onConnected: (listener) => {
      listener(true);
      return () => undefined;
    },
    close: () => undefined,
  };
}
