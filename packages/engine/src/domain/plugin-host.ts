import type { LocalizedText, ParamOption } from './plugin.js';
import type { SurfaceProvider, WidgetOnScreen } from './surface-spec.js';
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
   * Stores a setting the plugin worked out for itself.
   *
   * For the things a user cannot type: a token granted after they pressed
   * Allow in another program's window, a device id discovered on the network.
   * Saved exactly as the settings window would save it — sealed if the
   * manifest declared the field secret — so it survives a restart and the
   * plugin never asks again.
   *
   * The name must be a declared setting, which is what keeps this from
   * becoming a general-purpose store: what a plugin remembers is part of what
   * it says about itself.
   */
  remember(name: string, value: VariableValue): Promise<void>;

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

  /**
   * Draws one of the pictures this plugin declared in `surfaces`.
   *
   * Called only while a key showing it is on screen, which is the whole of the
   * thrift here: a graph is never drawn for a folder nobody has open, and the
   * plugin needs no `onWatched` of its own to know it.
   *
   * Answering `undefined` is normal — nothing is playing, the program is
   * closed — and leaves the key showing whatever still it was given, or
   * nothing. It is not an error and is not reported as one.
   */
  provideSurface(type: string, draw: SurfaceProvider): () => void;

  /**
   * Says that the pictures this plugin draws have changed, so ask again.
   *
   * A surface is only asked for while a repaint is happening, and a repaint
   * happens because something *else* moved — a variable, a press, a page turn.
   * That is enough for a plugin whose picture is a function of its own
   * variables: the hardware graph is live only because `hw.cpu` changes beside
   * it every two seconds and drags a repaint along with it.
   *
   * It is not enough for a picture that changes on its own schedule and has no
   * variable to ride on — a thumbnail of an OBS scene, a level meter. Without
   * this such a widget would be redrawn whenever something unrelated happened
   * to move, which is to say: never, on a quiet page.
   *
   * Blunt on purpose. It asks for a repaint rather than naming a key, because
   * every widget on screen is re-asked on any repaint anyway, and a picture
   * that comes back the same keeps its identity and so costs nothing further
   * down — the tile cache compares what was drawn, not who asked.
   */
  redraw(): void;

  /**
   * Which widgets are on screen, whoever declared them.
   *
   * The same bargain `onWatched` makes for variables, and scoped the same way:
   * a plugin hears about what is being drawn right now, not about every key of
   * every folder. That is what keeps this from being a way to read somebody's
   * whole configuration — and it is also all a plugin needs, since a key
   * nobody is looking at is a key nothing useful can be done to.
   *
   * Not filtered to this plugin's own widgets. A plugin may reasonably want to
   * point somebody else's graph at what it is talking about, and forbidding it
   * would be a fiction: a plugin can already run actions and write variables.
   */
  onWidgets(listen: (widgets: readonly WidgetOnScreen[]) => void): () => void;

  /**
   * Changes one setting of the widget on a key, for as long as this lasts.
   *
   * Laid over what the profile says rather than written into it. A key press
   * that edited the document would have the profile rewriting itself from use
   * instead of from editing — an export would then carry whatever was last
   * pressed, which is not what anybody authored.
   *
   * `undefined` takes the setting back to what the profile says. Overrides go
   * when a different profile is loaded and survive an edit to this one, which
   * is exactly how a button's forced state behaves.
   */
  setWidgetParam(buttonId: string, name: string, value: VariableValue | undefined): void;

  /**
   * Asks to be called back on a schedule the host keeps.
   *
   * Every plugin that reports on something needs a heartbeat, and each one
   * reaching for `setInterval` puts that heartbeat somewhere the host cannot
   * see: stopping such a plugin only asks it nicely to stop, and one that
   * forgets a timer goes on running for as long as the daemon does. Handing
   * the schedule over makes stopping mean stopping.
   *
   * It is also the same shape as everything else here — a request, not an
   * object — so it still works the day plugins run in a process of their own,
   * where a timer inside one is nothing the host could supervise.
   *
   * Register as many as the plugin has rhythms: a fast one for a reading, a
   * slow one for a list. Each answers only to its own handle.
   *
   * Ticks land on the period's own boundary rather than a period after
   * registration, so two plugins asking for two seconds wake the machine once
   * and a clock ticks *on* the second. A turn that is still running when the
   * next is due is not stacked on — that turn is dropped, and the beat carries
   * on. A turn that throws is logged and changes nothing: whether a failed
   * reading means the plugin is broken is for the plugin to say with
   * `setStatus`, not for the host to infer from one bad tick.
   */
  update(everyMs: number, run: () => Promise<void> | void): Ticker;

  /** Opens a URL in the user's browser: the way into any OAuth flow. */
  openExternal(url: string): void;

  log(level: 'info' | 'warn' | 'error', message: string): void;
}

/**
 * A running heartbeat, and the two things worth doing to one.
 *
 * `every` covers changing one's mind, which turns out to be the common case:
 * a clock wants a second while a countdown runs and a minute the rest of the
 * time, and a plugin nothing is reading wants nothing at all — which is what
 * an interval of zero says. Cheaper to say than to stop and register again,
 * and it keeps the handle a plugin already holds valid.
 */
export interface Ticker {
  /** Sets how often. Zero, or anything below it, pauses without unregistering. */
  every(ms: number): void;
  /** Gives the schedule back for good. */
  stop(): void;
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
