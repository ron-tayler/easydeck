/**
 * Outbound port: the deck hardware, as the engine needs it.
 *
 * Narrower than the device zone's `Surface` on purpose — the engine has no
 * business with brightness, sleep or connection lifecycle, and stating only
 * what it uses keeps it testable against a few lines of fake.
 */
export interface SurfacePort {
  readonly layout: { readonly rows: number; readonly cols: number };

  /** Registers a key press listener. Returns an unsubscribe function. */
  onKeyDown(listener: (key: number) => void): () => void;
  /** Registers a key release listener. Returns an unsubscribe function. */
  onKeyUp(listener: (key: number) => void): () => void;

  setKeyImage(key: number, image: Uint8Array): Promise<void>;
  clearKey(key: number): Promise<void>;
}
