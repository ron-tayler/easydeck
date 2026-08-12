import type { ParamDefinition } from './plugin.js';
import type { LocalizedText } from './plugin.js';

/**
 * A picture a plugin draws, as a key refers to it.
 *
 * The fourth thing a plugin contributes, beside actions, variables and
 * presets: `actions` is what a key does, `variables` is what it says in text,
 * and this is what it shows as a picture — a graph of the last five minutes,
 * album art, a scene thumbnail.
 *
 * Shaped like an action rather than like a variable, deliberately. It has a
 * type, a name, an icon for the palette and parameters the host draws, because
 * every one of these needs configuring — which sensor, over what period, in
 * what colour — and drawing a form from `ParamDefinition[]` is something the
 * editor already does, including lists that only exist while another program
 * is running.
 *
 * See `docs/live-surfaces.md` for why it sits on a state rather than a button,
 * and what happens when the plugin behind it is not there.
 */
export interface SurfaceDefinition {
  /** Qualified with the plugin's id, exactly as an action's type is. */
  readonly type: string;
  readonly label: LocalizedText;
  readonly description?: LocalizedText;
  /** Name from the action icon set, or a data URL. */
  readonly icon?: string;
  readonly params?: readonly ParamDefinition[];
}

/** What a state says about the picture it wants drawn for it. */
export interface SurfaceSpec {
  readonly type: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * What is being asked for, and how much room it has.
 *
 * Measured in keys rather than pixels, because the engine does not know what a
 * key is made of — `PresenterPort` deliberately keeps that on the other side.
 * A plugin answering with an SVG needs the shape and not the resolution
 * anyway; whoever wires this up may add a pixel hint on the way past, since it
 * is the one that owns the panel.
 */
export interface SurfaceRequest {
  readonly type: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** How many keys wide and tall the picture will cover. */
  readonly cols: number;
  readonly rows: number;
}

/**
 * One picture, and whether it is worth keeping.
 *
 * The distinction is the plugin's to make and nobody else's: album art will be
 * asked for again unchanged and should be recognised when it is, while a frame
 * of a graph is seen once and will never match anything again. Both survive a
 * cache that evicts by bytes, so this is thrift rather than correctness — but
 * only the plugin knows which of the two it is sending.
 */
export interface SurfaceFrame {
  /** A data URL, or the text of an SVG. */
  readonly source: string;
  /**
   * Identity of this picture, for the tile cache.
   *
   * A stable id on a picture that has not changed is what lets the panel skip
   * the write entirely. Omit it and every frame is treated as new, which is
   * right for a stream and wasteful for a still.
   */
  readonly id?: string;
}

/**
 * Draws the picture a key asked for.
 *
 * Answering nothing is normal and not a fault: OBS is closed, nothing is
 * playing. The key then shows its background and label, the way it would with
 * no picture at all. Being *unable* to answer — no such plugin — is a
 * different thing, and is the host's to report, not the plugin's.
 */
export type SurfaceProvider = (request: SurfaceRequest) => Promise<SurfaceFrame | undefined>;

/**
 * Identity of one live picture, for asking once and finding it again.
 *
 * Two keys showing the same graph of the same sensor over the same period are
 * one request, not two — and the parameters are what say so.
 */
export function surfaceKey(spec: SurfaceSpec): string {
  return `${spec.type}|${JSON.stringify(spec.params ?? {})}`;
}
