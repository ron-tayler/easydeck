import type { ActionHandler } from './action.js';
import type { Plugin } from './plugin-host.js';
import type { PluginManifest } from './plugin.js';

/**
 * What a plugin's code hands over when it is loaded from a folder.
 *
 * The built-in plugins each ship a `registerX` function that knows the
 * registry and the runtime. Code arriving from outside cannot be trusted to
 * wire itself into anything — and should not have to know those objects
 * exist. So an external plugin exports *data about itself* and one function,
 * and the host does the wiring, the same wiring for every plugin there will
 * ever be.
 *
 * The default export of a plugin's `main.mjs` is a `PluginModule`. The
 * `definePlugin` helper is nothing but that shape with the types attached —
 * it exists so an author gets completion and errors while writing, not so
 * anything happens at run time.
 */
export interface PluginModule {
  /**
   * The manifest, which the host treats as the plugin's identity.
   *
   * Also serialized to `plugin.json` at build time so a storefront can read
   * it without executing anything — but when both are present, this one is
   * the truth and a mismatch is a build error, not a choice.
   */
  readonly manifest: PluginManifest;
  /**
   * Builds the running parts. Called once, at load.
   *
   * A function rather than ready-made objects, so a plugin that holds state —
   * a connection, a cache — constructs it when it is actually wanted and not
   * as a side effect of being imported.
   */
  activate(): PluginActivation;
}

/** The running parts of a plugin; every one of them optional. */
export interface PluginActivation {
  /** The life: `start(host)` and `stop()`. A manifest-only plugin has none. */
  readonly plugin?: Plugin;
  /** One handler per action type the manifest declares. */
  readonly handlers?: Readonly<Record<string, ActionHandler>>;
  /** One handler per command the manifest declares, by command name. */
  readonly commands?: Readonly<Record<string, () => void | Promise<void>>>;
}

/** The identity function that carries the types. See `PluginModule`. */
export function definePlugin(module: PluginModule): PluginModule {
  return module;
}
