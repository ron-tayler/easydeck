import type { LocalizedText, ParamOption } from './plugin.js';
import type { VariableValue } from './variables.js';

/**
 * Everything a plugin may ask of the host, and nothing more.
 *
 * Deliberately a set of commands rather than a set of objects. A plugin never
 * receives the variable store, the deck registry or the HTTP server — it says
 * "set this variable", "I am connected", "route this path", and the host does
 * it. That is what keeps the boundary movable: built-in plugins call these
 * methods directly today, and the day third-party plugins run in a child
 * process, every one of these calls becomes a message without a line changing
 * inside the plugins themselves.
 *
 * Nothing here returns a live object either. `provideOptions` takes a
 * function and `route` takes a handler, both of which the host calls; the
 * plugin never holds anything of the host's.
 */
export interface PluginHost {
  /**
   * The settings as the user filled them in, secrets included.
   *
   * The plugin is the one place a secret has to be in the clear — it is the
   * thing that presents the token. Everywhere else it is stored sealed and
   * never leaves the daemon.
   */
  settings(): Readonly<Record<string, VariableValue>>;

  /**
   * Called after the user saves.
   *
   * The plugin decides what that means: a changed port is a reconnect, a
   * changed polling interval is a new timer. The host does not restart it,
   * because only the plugin knows which of its settings are worth the
   * interruption.
   */
  onSettingsChanged(listen: (settings: Readonly<Record<string, VariableValue>>) => void): () => void;

  /**
   * Publishes a value for buttons to show and bind to.
   *
   * The name must be one the manifest declared, which is also what keeps a
   * plugin from writing over the user's variables or another plugin's.
   * `undefined` clears it — which is what a plugin should do when it loses its
   * connection, so a key stops presenting last hour's viewer count as if it
   * were current.
   */
  setVariable(name: string, value: VariableValue | undefined): void;

  /**
   * Publishes a value under a family key: `setFamily('obs.mute', 'Микрофон', true)`.
   *
   * Separate from `setVariable` so the plugin never builds the key itself,
   * and so the host can check the family was declared without parsing every
   * name it is handed.
   */
  setFamily(family: string, argument: string, value: VariableValue | undefined): void;

  /** Where the plugin is up to, shown on its gear and beside its actions. */
  setStatus(status: PluginStatus, message?: LocalizedText): void;

  /**
   * The keys of this plugin's variables that something is actually reading.
   *
   * Gathered from every loaded profile — the labels that substitute them and
   * the buttons bound to them — and sent again whenever a profile changes.
   *
   * This is what makes a family of variables affordable. A plugin reporting
   * on every audio input, every source in every scene and every filter would
   * otherwise publish hundreds of values, almost none of them looked at by
   * anybody, and ask the program it talks to about all of them on every
   * connect. Told what is wanted, it can watch that and nothing else.
   *
   * Keys arrive whole, argument included: `obs.mute(Микрофон)`.
   */
  onWatched(listen: (keys: readonly string[]) => void): () => void;

  /**
   * Supplies the choices for a parameter declared with `optionsFrom`.
   *
   * Registered under a name local to the plugin; the host qualifies it. The
   * loader runs when a configurator opens the parameter, not when it is
   * registered, so a plugin may register sources before it can answer them.
   */
  provideOptions(name: string, load: OptionLoader): () => void;

  /**
   * Claims a path on the loopback callback server: `/plugin/<id>/<path>`.
   *
   * Loopback and nothing else. The main server can be opened to the network
   * for the web deck, and an OAuth code arriving over an open port is a code
   * anybody on that network can take. Returns a function that gives the path
   * back; the server stops listening when the last route is gone.
   */
  route(path: string, handle: RouteHandler): () => void;

  /** Opens a URL in the user's browser: the way into any OAuth flow. */
  openExternal(url: string): void;

  log(level: 'info' | 'warn' | 'error', message: string): void;
}

/**
 * Supplies the choices for a parameter, given what is already filled in.
 *
 * The argument is what makes a dependent list possible: which filters exist
 * depends on which source was chosen, and the configurator knows that before
 * the plugin does. Ignored by every list that does not depend on anything.
 */
export type OptionLoader = (
  params: Readonly<Record<string, unknown>>,
) => Promise<readonly ParamOption[]>;

/**
 * Where a plugin is up to, in the four states a user can act on.
 *
 * Not an error string alone, because "no OBS on port 4455" and "no password
 * set yet" want different answers from the person reading them, and a key
 * bound to a plugin that is merely still connecting should not look broken.
 */
export type PluginStatus = 'off' | 'connecting' | 'ready' | 'error';

export interface RouteRequest {
  readonly method: string;
  /** The part after `/plugin/<id>`, always starting with a slash. */
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface RouteResponse {
  readonly status?: number;
  readonly contentType?: string;
  readonly body?: string;
}

export type RouteHandler = (request: RouteRequest) => Promise<RouteResponse> | RouteResponse;

/**
 * A plugin's life, which is shorter than the daemon's.
 *
 * Both halves are optional: a plugin that only contributes actions — the
 * built-in navigation, system and media ones — has nothing to start and
 * nothing to stop, and should not have to say so twice.
 */
export interface Plugin {
  start?(host: PluginHost): Promise<void> | void;
  stop?(): Promise<void> | void;
}
