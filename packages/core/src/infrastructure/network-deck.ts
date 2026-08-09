import type { ButtonEvent, PresenterPort, Scene } from '@easydeck/engine';

/**
 * A deck that lives on someone else's screen.
 *
 * The difference from a panel is what crosses the wire. A panel is sent
 * pixels, because it can do nothing else; a tablet is sent the *scene* and
 * draws it itself, so a stretched animation costs one description and one
 * download of the picture rather than a stream of JPEGs at thirty frames a
 * second.
 *
 * Nothing here composes or encodes anything, which is why a network deck has
 * no compositor at all.
 *
 * Gestures arrive already recognised. The device knows whether a touch was a
 * tap, a hold or a double press long before the daemon could work it out from
 * timings that crossed a network, and a slow link would otherwise turn a
 * double tap into two singles.
 */
export class NetworkDeck implements PresenterPort {
  private readonly listeners = new Set<(key: number, gesture: ButtonEvent) => void>();
  /** The scene this deck is showing, replayed to a client that reconnects. */
  private current?: Scene;
  private doublePress: readonly number[] = [];

  constructor(
    readonly layout: { readonly rows: number; readonly cols: number },
    /** Sends a scene to the device. Failures are the transport's business. */
    private readonly send: (scene: Scene, doublePressKeys: readonly number[]) => void,
  ) {}

  onGesture(listener: (key: number, gesture: ButtonEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async present(scene: Scene): Promise<void> {
    this.current = scene;
    this.send(scene, this.doublePress);
  }

  setDoublePressKeys(keys: readonly number[]): void {
    this.doublePress = keys;
  }

  /** Reports a gesture the device recognised. */
  report(key: number, gesture: ButtonEvent): void {
    for (const listener of this.listeners) listener(key, gesture);
  }

  /**
   * Sends the current scene again.
   *
   * For a device that comes back — a reloaded page, a phone that slept. The
   * engine is not asked to rebuild anything, because nothing about the deck
   * changed while it was away.
   */
  resend(): void {
    if (this.current) this.send(this.current, this.doublePress);
  }
}
