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
  SurfaceFrame,
  SurfaceProvider,
  SurfaceRequest,
  Ticker,
  WidgetOnScreen,
  VariableStore,
  VariableValue,
} from '@easydeck/engine';

import { parseVariableKey, variableKey } from '@easydeck/engine';

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
  /**
   * Lays a widget setting over what the profile says, on every deck showing it.
   *
   * Every deck, unlike the macro, which changes the one whose key was pressed:
   * a plugin saying "point that graph at the memory" is talking about the key,
   * and the key may be on a panel and a tablet at once.
   */
  readonly setWidgetParam?: (
    pluginId: string,
    buttonId: string,
    name: string,
    value: VariableValue | undefined,
  ) => void;
  /**
   * Asks every deck to paint again, because a plugin's picture has changed.
   *
   * Every deck, for the same reason `setWidgetParam` is: the key showing that
   * picture may be on a panel and a tablet at once.
   */
  readonly redraw?: () => void;
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
  /** Live pictures this plugin draws, by the type a key names. */
  readonly surfaces: Map<string, SurfaceProvider>;
  readonly routes: Array<() => void>;
  /** Heartbeats the host is keeping for it, so stopping can really stop them. */
  readonly tickers: Array<() => void>;
  readonly variables: Set<string>;
  /** Families this plugin declared, which take an argument. */
  readonly families: Set<string>;
  readonly watchers: Array<(keys: readonly string[]) => void>;
  /** Told what widgets are on screen, whoever declared them. */
  readonly widgetWatchers: Array<(widgets: readonly WidgetOnScreen[]) => void>;
  /** What was last reported as being watched, for a plugin that starts late. */
  watched: readonly string[];
}

export class PluginRuntime extends EventEmitter<PluginRuntimeEvents> {
  private readonly entries = new Map<string, Entry>();
  /** Every key the loaded profiles read, across all plugins. */
  private watched: readonly string[] = [];
  /** What is being drawn right now, for a plugin that installs late. */
  private widgets: readonly WidgetOnScreen[] = [];
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
      surfaces: new Map(),
      routes: [],
      tickers: [],
      variables: new Set(
        (manifest.variables ?? [])
          .filter((variable) => variable.argument === undefined)
          .map((variable) => variable.name),
      ),
      families: new Set(
        (manifest.variables ?? [])
          .filter((variable) => variable.argument !== undefined)
          .map((variable) => variable.name),
      ),
      watchers: [],
      widgetWatchers: [],
      watched: this.watched.filter((key) => this.belongsTo(key, manifest.id)),
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

  /**
   * Draws a live picture, whichever plugin owns it.
   *
   * The type is qualified with the plugin's id, exactly as an action's is, so
   * the owner is read off the name rather than searched for.
   *
   * A type nobody claims answers `undefined` and the key falls back to its own
   * picture. That is deliberately the *same* answer as "the plugin is here and
   * has nothing to show": telling a missing plugin from an idle one is the
   * configurator's job, where the manifests are, and not something to decide
   * from a blank frame. See `docs/live-surfaces.md`.
   */
  async drawSurface(request: SurfaceRequest): Promise<SurfaceFrame | undefined> {
    // Up to the *last* dot: a surface type is `<pluginId>.<name>`, and a
    // plugin id may itself carry an author — `ed.obs.thumbnail` belongs to
    // `ed.obs`, not to a plugin called `ed`.
    const pluginId = request.type.slice(0, request.type.lastIndexOf('.'));
    const draw = this.entries.get(pluginId)?.surfaces.get(request.type);
    if (!draw) return undefined;

    try {
      const frame = await draw(request);
      return frame ? { ...frame, source: asDataUrl(frame.source) } : undefined;
    } catch (cause) {
      this.options.log?.(pluginId, 'warn', `Could not draw '${request.type}': ${describe(cause)}`);
      return undefined;
    }
  }

  /**
   * Tells every plugin what widgets are on screen.
   *
   * Not filtered to each plugin's own, unlike the watched variables: a plugin
   * may reasonably want to point somebody else's graph at what it is talking
   * about, and it cannot do that without being able to see it. What keeps this
   * modest is the scope — what is being drawn, not what exists.
   */
  setWidgets(widgets: readonly WidgetOnScreen[]): void {
    this.widgets = widgets;

    for (const entry of this.entries.values()) {
      for (const listen of [...entry.widgetWatchers]) {
        try {
          listen(widgets);
        } catch (cause) {
          this.fail(entry, cause);
        }
      }
    }
  }

  /**
   * Tells each plugin which of its keys anything is reading.
   *
   * Called with every key the loaded profiles mention; each plugin hears only
   * its own. A plugin that hears nothing stops watching, which is the point —
   * the alternative is asking OBS about fifty inputs so that one key can show
   * whether the microphone is muted.
   */
  setWatched(keys: readonly string[]): void {
    this.watched = keys;

    for (const entry of this.entries.values()) {
      const mine = keys.filter((key) => this.belongsTo(key, entry.manifest.id));

      // Unchanged is not worth telling: a plugin reacts by asking the program
      // it talks to, and a profile save that touched nothing of its should
      // not cost a round of requests.
      if (same(mine, entry.watched)) continue;

      entry.watched = mine;
      for (const listen of [...entry.watchers]) {
        try {
          listen(mine);
        } catch (cause) {
          this.fail(entry, cause);
        }
      }
    }
  }

  private belongsTo(key: string, pluginId: string): boolean {
    return parseVariableKey(key).family.startsWith(`${pluginId}.`);
  }

  /** Stops everything, in the reverse order it was started. */
  async stopAll(): Promise<void> {
    for (const entry of [...this.entries.values()].reverse()) {
      for (const release of entry.routes.splice(0)) release();
      // Before `stop` rather than after: a heartbeat that fired while the
      // plugin was shutting down would arrive at a plugin that had already
      // let go of whatever the tick was about.
      for (const release of entry.tickers.splice(0)) release();
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

      /**
       * A setting the plugin worked out for itself, stored the ordinary way.
       *
       * Through `configure`, so a token granted by another program lands in
       * the sealed file exactly as a typed one would, and so the plugin's own
       * listeners hear about it — there is no second path into the settings
       * for the host to keep in step.
       */
      remember: async (name, value) => {
        const declared = (entry.manifest.settings ?? []).some((param) => param.name === name);
        if (!declared) {
          throw new Error(`Plugin '${id}' has no setting '${name}' to remember`);
        }

        await this.configure(id, { [name]: value });
      },

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

      setFamily: (family, argument, value) => {
        if (!entry.families.has(family)) {
          throw new Error(`Plugin '${id}' writes family '${family}' without declaring it`);
        }

        const key = variableKey(family, argument);
        if (value === undefined) this.options.variables.delete(key);
        else this.options.variables.set(key, value);
      },

      onWatched: (listen) => {
        entry.watchers.push(listen);
        // Told at once what is already wanted: a plugin installed after the
        // profiles were loaded would otherwise wait for the next edit to
        // learn there is anything to watch at all.
        if (entry.watched.length > 0) listen(entry.watched);

        return () => {
          const at = entry.watchers.indexOf(listen);
          if (at >= 0) entry.watchers.splice(at, 1);
        };
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

      provideSurface: (type, draw) => {
        entry.surfaces.set(type, draw);
        return () => entry.surfaces.delete(type);
      },

      // Quietly nothing where no deck is listening, unlike its neighbours
      // which throw: this one is called on a beat rather than by a key press,
      // and a plugin drawing into a headless test should not be punished for
      // asking for a repaint that nobody needs.
      redraw: () => this.options.redraw?.(),

      onWidgets: (listen) => {
        entry.widgetWatchers.push(listen);
        // Told at once what is already on screen: a plugin that installs after
        // the deck started would otherwise hear nothing until the page turned.
        if (this.widgets.length > 0) listen(this.widgets);
        return () => {
          const at = entry.widgetWatchers.indexOf(listen);
          if (at !== -1) entry.widgetWatchers.splice(at, 1);
        };
      },

      setWidgetParam: (buttonId, name, value) => {
        if (!this.options.setWidgetParam) {
          throw new Error(`Plugin '${id}' changed a widget, but no deck is listening`);
        }
        this.options.setWidgetParam(id, buttonId, name, value);
      },

      update: (everyMs, run) => this.beat(entry, everyMs, run),

      openExternal: (url) => {
        if (!this.options.openExternal) {
          throw new Error(`Plugin '${id}' asked to open '${url}', but nothing can open it here`);
        }
        this.options.openExternal(url);
      },

      log: (level, message) => this.options.log?.(id, level, message),
    };
  }

  /**
   * A heartbeat the host keeps on a plugin's behalf.
   *
   * Three decisions live in here, and all three are the reason this is worth
   * taking off the plugins.
   *
   * *Aligned, not offset.* The next tick is the next boundary of the period,
   * not a period from now. Two plugins asking for two seconds then land on the
   * same instant and wake the machine once, and a clock asking for a second
   * ticks on the second rather than a little after whenever it started.
   *
   * *Dropped, not stacked.* A turn still running when the next falls due loses
   * that turn. A plugin polling something that has become slow would otherwise
   * accumulate turns it can never catch up on, and the queue is the failure.
   *
   * *Logged, not blamed.* A throw does not put the plugin in `error`. A poll
   * that fails while the network is out says nothing about whether the plugin
   * works, and the plugin knows which of its failures matter — that is what
   * `setStatus` is for. The alternative was a status event every two seconds
   * for as long as a router was rebooting.
   */
  private beat(entry: Entry, everyMs: number, run: () => Promise<void> | void): Ticker {
    let period = 0;
    let timer: NodeJS.Timeout | undefined;
    let inside = false;
    let done = false;

    const arm = (): void => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (done || period <= 0) return;

      timer = setTimeout(fire, period - (Date.now() % period));
      // A plugin's heartbeat is never a reason for the daemon to stay up.
      timer.unref?.();
    };

    const fire = (): void => {
      timer = undefined;
      // Re-armed before the work, so a slow turn delays nothing but itself.
      arm();
      if (inside) return;

      inside = true;
      void (async () => {
        try {
          await run();
        } catch (cause) {
          this.options.log?.(entry.manifest.id, 'error', describe(cause));
        } finally {
          inside = false;
        }
      })();
    };

    const ticker: Ticker = {
      every: (ms) => {
        period = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
        arm();
      },
      stop: () => {
        done = true;
        arm();
      },
    };

    ticker.every(everyMs);
    entry.tickers.push(() => ticker.stop());
    return ticker;
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

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * A plugin's picture in the one form everything below this expects.
 *
 * A plugin may answer with the text of an SVG, which is the convenient thing
 * to build and the natural thing to return. Everything downstream — the scene,
 * the compositor, the rasterizer — takes a *source*, and a source is a path or
 * a data URL; handed raw markup it goes looking for a file with a name
 * beginning `<svg`, fails to find one, and the key says the picture could not
 * be read.
 *
 * Converted here rather than asked of every plugin, so the convenience stays
 * with the plugins and the pipeline keeps one representation. Base64 rather
 * than percent-encoding because that is the only form `readSource` decodes,
 * and one encoding that always works beats two that sometimes do.
 */
function asDataUrl(source: string): string {
  if (source.startsWith('data:')) return source;

  return `data:image/svg+xml;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
}
