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
 * A property of the hardware rather than a tuning knob, and the reason the
 * compositor plans at all. Where it does *not* bind, measured against a D6
 * over its own driver rather than inferred from a capture of somebody else's
 * software:
 *
 * | tile                       | writes/s | whole panel |
 * | -------------------------- | -------- | ----------- |
 * | flat colour, ~800 B        |     ~1900 |    ~125 fps |
 * | ordinary art, ~4.7 kB      |      ~800 |     ~53 fps |
 * | at the 10 kB limit         |      ~540 |     ~36 fps |
 *
 * So fifteen keys at 30fps — 450 writes a second — fits even when every tile
 * is against the firmware's byte limit. An earlier figure of 233, read off a
 * USB capture of the vendor's application, was measuring that application and
 * not the panel.
 *
 * The shape worth knowing is that this is not one number but a line: roughly
 * 0.4 ms of fixed cost per write plus six or seven megabytes a second of
 * payload. A single rate is therefore wrong in both directions — it
 * under-promises fourfold for cheap tiles and over-promises for photographs —
 * which is why `WriteBudget` learns from what actually happened rather than
 * trusting this. Seeded with the worst case on purpose: planning under the
 * true rate costs smoothness, planning over it grows a queue the panel can
 * never drain.
 */
export const DEFAULT_WRITES_PER_SECOND = 540;
