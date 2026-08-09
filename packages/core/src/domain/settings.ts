/** What one deck is set up to do, remembered between runs. */
export interface DeckBinding {
  readonly profileId?: string;
  /** What the user calls this deck, if they renamed it. */
  readonly name?: string;
}

/** Daemon-wide settings, persisted next to the profiles. */
export interface DaemonSettings {
  /**
   * Profile for a deck with no binding of its own — a panel plugged in for the
   * first time, or the only one there is.
   */
  readonly activeProfileId?: string;
  /** Panel backlight, 0..100. One number for the whole machine. */
  readonly brightness: number;
  /**
   * Per-deck settings, by deck id.
   *
   * This is what lets two panels run different profiles: the profile belongs
   * to the deck, not to the daemon. Absent for a fresh install, and for any
   * deck the user has not set up yet.
   */
  readonly decks?: Readonly<Record<string, DeckBinding>>;
  /**
   * Whether the daemon answers on the network rather than on loopback alone.
   *
   * Off unless someone turns it on. The API can write profiles and a profile
   * can launch programs, so an open port here is an open shell — that is a
   * decision to take deliberately, not a default to inherit.
   */
  readonly networkAccess?: boolean;
  /** Port the API and the configurator are served on. */
  readonly port?: number;
  /**
   * Whether another device may become a deck of its own.
   *
   * Separate from network access because they are separate decisions: someone
   * may want the configurator reachable from a laptop without every phone on
   * the network being able to claim a deck.
   */
  readonly networkDecks?: boolean;
  /**
   * Whether an approved device may drive the whole API rather than only its
   * own deck.
   *
   * This is what a script or another program needs — reading state, setting
   * variables, turning pages. It is off by default: a deck needs none of it,
   * and handing it out by default would make every approved tablet a remote
   * control for the machine.
   */
  readonly extensionsApi?: boolean;
}

export const DEFAULT_SETTINGS: DaemonSettings = { brightness: 60 };

/** Coerces an untrusted settings document into something safe to use. */
export function normalizeSettings(raw: unknown): DaemonSettings {
  const value = (raw ?? {}) as Partial<Record<keyof DaemonSettings, unknown>>;
  const brightness = Number(value.brightness);

  return {
    activeProfileId: typeof value.activeProfileId === 'string' ? value.activeProfileId : undefined,
    brightness: Number.isFinite(brightness)
      ? Math.min(100, Math.max(0, Math.round(brightness)))
      : DEFAULT_SETTINGS.brightness,
    ...(normalizeDecks(value.decks) ?? {}),
    // Anything other than a literal true leaves the daemon on loopback.
    ...(value.networkAccess === true ? { networkAccess: true } : {}),
    ...(value.networkDecks === true ? { networkDecks: true } : {}),
    ...(value.extensionsApi === true ? { extensionsApi: true } : {}),
    ...normalizePort(value.port),
  };
}

/**
 * Keeps only entries that look like deck bindings.
 *
 * The settings file is meant to be edited by hand, so a half-written entry is
 * an ordinary occurrence rather than an attack: drop what cannot be understood
 * and keep the rest, instead of refusing to start.
 */
function normalizeDecks(raw: unknown): { decks: Record<string, DeckBinding> } | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

  const decks: Record<string, DeckBinding> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue;

    const binding = entry as Partial<Record<keyof DeckBinding, unknown>>;
    decks[id] = {
      ...(typeof binding.profileId === 'string' ? { profileId: binding.profileId } : {}),
      ...(typeof binding.name === 'string' ? { name: binding.name } : {}),
    };
  }

  return Object.keys(decks).length > 0 ? { decks } : undefined;
}

/** Keeps a port only if it is one; anything else falls back to the default. */
function normalizePort(raw: unknown): { port: number } | Record<string, never> {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return {};
  return { port };
}
