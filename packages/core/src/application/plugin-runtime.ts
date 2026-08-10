import { EventEmitter } from 'node:events';

import type {
  LocalizedText,
  OptionLoader,
  ParamOption,
  Plugin,
  PluginHost,
  PluginManifest,
  PluginStatus,
  RouteHandler,
  VariableStore,
  VariableValue,
} from '@easydeck/engine';

import type { PluginSettingsStore } from '../infrastructure/plugins/plugin-settings-store.js';

/**
 * The plugins that are running, and everything the host does on their behalf.
 *
 * A plugin is two halves that meet here: a manifest, which the registry
 * already knows about because its actions are in the palette, and a life —
 * a connection to OBS, a timer reading the processor, a token being
 * refreshed. Actions alone needed none of this, which is why it did not exist
 * until now.
 *
 * Every call a plugin makes arrives through the `PluginHost` this class hands
 * out, and none of them passes an object of ours back. That is what keeps a
 * third-party plugin one refactor — not one rewrite — away from running in
 * its own process: each method is already a message.
 */

export interface PluginState {
  readonly manifest: PluginManifest;
  readonly status: PluginStatus;
  readonly message?: LocalizedText;
}

export interface PluginRuntimeEvents {
  /** A plugin's status changed; the configurator repaints its gear. */
  status: [pluginId: string, status: PluginStatus, message?: LocalizedText];
  error: [error: Error];
}

export interface PluginRuntimeOptions {
  readonly settings: PluginSettingsStore;
  /** Where a plugin's published variables land. Shared by every deck. */
  readonly variables: VariableStore;
  /** Claims a path on the loopback server; absent until that server exists. */
  readonly route?: (pluginId: string, path: string, handle: RouteHandler) => () => void;
  /** Opens a URL in the user's browser. */
  readonly openExternal?: (url: string) => void;
  readonly log?: (pluginId: string, level: 'info' | 'warn' | 'error', message: string) => void;
}

interface Entry {
  readonly manifest: PluginManifest;
  readonly plugin: Plugin;
  status: PluginStatus;
  message?: LocalizedText;
  settings: Record<string, VariableValue>;
  readonly listeners: Array<(settings: Readonly<Record<string, VariableValue>>) => void>;
  readonly options: Map<string, OptionLoader>;
  readonly routes: Array<() => void>;
  readonly variables: Set<string>;
}

export class PluginRuntime extends EventEmitter<PluginRuntimeEvents> {
  private readonly entries = new Map<string, Entry>();
  /**
   * What a plugin's settings-window buttons actually do.
   *
   * Kept beside the runtime rather than in the manifest for the same reason
   * action handlers are: the manifest is data a configurator reads, and code
   * is not.
   */
  private readonly commands = new Map<string, () => Promise<void> | void>();

  constructor(private readonly options: PluginRuntimeOptions) {
    super();
  }

  /**
   * Starts a plugin with the settings it was last given.
   *
   * A plugin that throws on the way up is left in `error` with the reason,
   * rather than taking the daemon with it. Half the plugins here talk to
   * programs that may simply not be installed, and "OBS plugin: connection
   * refused" is a state a person can act on.
   */
  async install(manifest: PluginManifest, plugin: Plugin): Promise<void> {
    if (this.entries.has(manifest.id)) {
      throw new Error(`Plugin '${manifest.id}' is already running`);
    }

    const entry: Entry = {
      manifest,
      plugin,
      status: 'off',
      settings: await this.options.settings.load(manifest.id),
      listeners: [],
      options: new Map(),
      routes: [],
      variables: new Set((manifest.variables ?? []).map((variable) => variable.name)),
    };
    this.entries.set(manifest.id, entry);

    await this.guard(entry, () => entry.plugin.start?.(this.hostFor(entry)));
  }

  /** Every plugin that has a life of its own, with where it has got to. */
  list(): PluginState[] {
    return [...this.entries.values()].map((entry) => ({
      manifest: entry.manifest,
      status: entry.status,
      ...(entry.message ? { message: entry.message } : {}),
    }));
  }

  status(pluginId: string): PluginState | undefined {
    const entry = this.entries.get(pluginId);
    if (!entry) return undefined;
    return {
      manifest: entry.manifest,
      status: entry.status,
      ...(entry.message ? { message: entry.message } : {}),
    };
  }

  /**
   * Saves what the user typed and tells the plugin.
   *
   * The plugin is not restarted: only it knows whether a changed field is
   * worth dropping a connection for, and restarting on every keystroke-sized
   * change would make a settings window a thing you dread pressing Save in.
   */
  async configure(
    pluginId: string,
    values: Readonly<Record<string, VariableValue>>,
  ): Promise<void> {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`No plugin '${pluginId}' is running`);

    await this.options.settings.save(pluginId, values, entry.manifest.settings ?? []);
    entry.settings = await this.options.settings.load(pluginId);

    for (const listen of [...entry.listeners]) {
      try {
        listen(entry.settings);
      } catch (cause) {
        this.fail(entry, cause);
      }
    }
  }

  /** Runs one of the buttons at the foot of a plugin's settings window. */
  async runCommand(pluginId: string, command: string): Promise<void> {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`No plugin '${pluginId}' is running`);

    const declared = (entry.manifest.commands ?? []).some((each) => each.name === command);
    if (!declared) throw new Error(`Plugin '${pluginId}' has no command '${command}'`);

    const handler = this.commands.get(`${pluginId}.${command}`);
    if (!handler) throw new Error(`Plugin '${pluginId}' declares '${command}' without a handler`);

    await handler();
  }

  /**
   * The choices for a parameter declared with `optionsFrom`.
   *
   * An empty list where the source is unknown or the plugin cannot answer:
   * the configurator falls back to a plain text field, which is what lets
   * somebody set up an OBS button while OBS is closed.
   */
  async optionsFor(
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>> = {},
  ): Promise<readonly ParamOption[]> {
    const entry = this.entries.get(pluginId);
    const load = entry?.options.get(source);
    if (!load) return [];

    try {
      return await load(params);
    } catch (cause) {
      this.options.log?.(pluginId, 'warn', `Could not list '${source}': ${describe(cause)}`);
      return [];
    }
  }

  /** Stops everything, in the reverse order it was started. */
  async stopAll(): Promise<void> {
    for (const entry of [...this.entries.values()].reverse()) {
      for (const release of entry.routes.splice(0)) release();
      entry.listeners.length = 0;

      // Its variables go with it. Leaving the last scene name on a key after
      // the plugin behind it has stopped is the deck telling a lie.
      for (const name of entry.variables) this.options.variables.delete(name);

      await this.guard(entry, () => entry.plugin.stop?.());
      entry.status = 'off';
    }
    this.entries.clear();
  }

  /** What a plugin was configured with, secrets included; for the host only. */
  async settingsOf(pluginId: string): Promise<Readonly<Record<string, VariableValue>>> {
    const entry = this.entries.get(pluginId);
    if (!entry) throw new Error(`No plugin '${pluginId}' is running`);
    return entry.settings;
  }

  /** Which secret fields are filled in — never what is in them. */
  async filledSecretsOf(pluginId: string): Promise<readonly string[]> {
    return this.options.settings.filledSecrets(pluginId);
  }

  /** Registers the code behind the commands a manifest declares. */
  registerCommands(
    pluginId: string,
    handlers: Readonly<Record<string, () => Promise<void> | void>>,
  ): void {
    for (const [name, handler] of Object.entries(handlers)) {
      this.commands.set(`${pluginId}.${name}`, handler);
    }
  }

  private hostFor(entry: Entry): PluginHost {
    const id = entry.manifest.id;

    return {
      settings: () => entry.settings,

      onSettingsChanged: (listen) => {
        entry.listeners.push(listen);
        return () => {
          const at = entry.listeners.indexOf(listen);
          if (at >= 0) entry.listeners.splice(at, 1);
        };
      },

      setVariable: (name, value) => {
        // Checked rather than trusted: a plugin writing to `micOn` because it
        // happens to like the name would silently fight the user's own
        // variable, and the two would be indistinguishable afterwards.
        if (!entry.variables.has(name)) {
          throw new Error(`Plugin '${id}' writes '${name}' without declaring it`);
        }
        if (value === undefined) this.options.variables.delete(name);
        else this.options.variables.set(name, value);
      },

      setStatus: (status, message) => {
        entry.status = status;
        entry.message = message;
        this.emit('status', id, status, message);
      },

      provideOptions: (name, load) => {
        entry.options.set(name, load);
        return () => entry.options.delete(name);
      },

      route: (path, handle) => {
        if (!this.options.route) {
          throw new Error(`Plugin '${id}' asked for a route, but no callback server is running`);
        }
        const release = this.options.route(id, path, handle);
        entry.routes.push(release);
        return release;
      },

      openExternal: (url) => {
        if (!this.options.openExternal) {
          throw new Error(`Plugin '${id}' asked to open '${url}', but nothing can open it here`);
        }
        this.options.openExternal(url);
      },

      log: (level, message) => this.options.log?.(id, level, message),
    };
  }

  /** Runs a plugin's own code, turning a throw into a status it can explain. */
  private async guard(entry: Entry, run: () => Promise<void> | void): Promise<void> {
    try {
      await run();
    } catch (cause) {
      this.fail(entry, cause);
    }
  }

  private fail(entry: Entry, cause: unknown): void {
    entry.status = 'error';
    entry.message = { en: describe(cause) };
    this.emit('status', entry.manifest.id, entry.status, entry.message);
    this.emit('error', cause instanceof Error ? cause : new Error(describe(cause)));
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
