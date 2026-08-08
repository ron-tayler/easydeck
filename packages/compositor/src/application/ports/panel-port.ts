/**
 * Outbound port: the panel hardware, as narrow as the compositor needs it.
 *
 * Deliberately smaller than the device zone's `Surface` — no brightness, no
 * sleep, no lifecycle. Writing a tile and clearing a key is the whole of it,
 * which makes a fake for tests a few lines long.
 */
export interface PanelPort {
  /** Uploads one encoded tile and commits it. */
  writeKey(key: number, image: Uint8Array): Promise<void>;
  clearKey(key: number): Promise<void>;
}

/**
 * What the panel can physically swallow, in images a second.
 *
 * Not a tuning knob — a property of the hardware, and the binding constraint
 * for anything animated. A USB capture of the vendor software tops out at 233
 * images a second across the whole panel; a 30fps picture stretched over
 * fifteen keys asks for 451. Something has to give, and it is better that the
 * compositor chooses (drop frames, keep time) than that the write queue grows
 * without bound until the panel is seconds behind the clock.
 */
export const DEFAULT_WRITES_PER_SECOND = 233;
