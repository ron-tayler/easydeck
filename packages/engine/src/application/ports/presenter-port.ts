import type { Scene } from '../../domain/scene.js';

/**
 * Outbound port: the panel, as the engine needs it.
 *
 * Narrower than it looks. The engine says what the panel should show and
 * hears about presses; it never learns which key gets which slice of a
 * picture, what is worth re-encoding, or how fast an animation may run before
 * the bus gives out. All of that belongs to whoever implements this.
 *
 * The previous shape of this port — `setKeyImage(key, bytes)` — is what made
 * those decisions the engine's problem, and it had no way to make them well:
 * it could see one key at a time.
 */
export interface PresenterPort {
  readonly layout: { readonly rows: number; readonly cols: number };

  /** Registers a key press listener. Returns an unsubscribe function. */
  onKeyDown(listener: (key: number) => void): () => void;
  /** Registers a key release listener. Returns an unsubscribe function. */
  onKeyUp(listener: (key: number) => void): () => void;

  /** Resolves once the scene is visibly on the panel. */
  present(scene: Scene): Promise<void>;
}
