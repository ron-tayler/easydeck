import type { KeyImageFormat } from './key-image.js';
import type { KeyLayout } from './key-layout.js';

export interface KeyEvent {
  /** Logical key index: 0-based, row-major, top-left origin. */
  readonly key: number;
  readonly row: number;
  readonly col: number;
}

export interface SurfaceEventMap {
  keyDown: [event: KeyEvent];
  keyUp: [event: KeyEvent];
  error: [error: Error];
  disconnected: [];
}

/** Minimal typed event contract so the domain does not depend on node:events. */
export interface SurfaceEvents {
  on<E extends keyof SurfaceEventMap>(event: E, listener: (...args: SurfaceEventMap[E]) => void): this;
  once<E extends keyof SurfaceEventMap>(event: E, listener: (...args: SurfaceEventMap[E]) => void): this;
  off<E extends keyof SurfaceEventMap>(event: E, listener: (...args: SurfaceEventMap[E]) => void): this;
}

export interface SurfaceInfo {
  readonly modelId: string;
  readonly modelName: string;
  readonly serialNumber?: string;
  readonly path?: string;
}

/**
 * A connected key-display surface, addressed by logical key indices.
 *
 * This is the single seam between the device zone and the rest of the
 * application: the engine talks to a Surface and never learns about HID,
 * report framing or device-specific key numbering.
 */
export interface Surface extends SurfaceEvents {
  readonly info: SurfaceInfo;
  readonly layout: KeyLayout;
  readonly keyImage: KeyImageFormat;

  /** Uploads a pre-encoded image (see `keyImage`) to one key and commits it. */
  setKeyImage(key: number, image: Uint8Array): Promise<void>;
  clearKey(key: number): Promise<void>;
  clearAllKeys(): Promise<void>;
  /** 0..100 */
  setBrightness(percent: number): Promise<void>;
  wake(): Promise<void>;
  sleep(): Promise<void>;
  /** Releases the device. The instance is unusable afterwards. */
  close(): Promise<void>;
}
