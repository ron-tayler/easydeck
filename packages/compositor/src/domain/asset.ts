/**
 * A picture, referred to by a short id rather than by its bytes.
 *
 * This exists because of a single measurement. A cache keyed on the picture
 * itself means a data URL — a megabyte and a half for one animated icon —
 * takes part in every comparison and every cache lookup. On the old path that
 * cost 22ms of blocked event loop on *each* repaint, which is to say on every
 * variable change, long after everything was warm.
 *
 * So the source travels once, to whoever has to decode it, and everything else
 * — cache keys, scene diffs, log lines — carries the id.
 */
export type AssetId = string;

export interface AssetRef {
  readonly id: AssetId;
  /** A path on disk or a data URL. Resolved to bytes by whoever decodes it. */
  readonly source: string;
}
