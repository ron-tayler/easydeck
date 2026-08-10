import { validateProfile } from '@easydeck/engine';
import type { KeyView, ProfileDefinition, VariableValue } from '@easydeck/engine';

import type { RequestMessage, ResponseMessage } from '../domain/api-messages.js';
import { isRequestMessage } from '../domain/api-messages.js';
import type { AppFolder, DeckFacade } from './ports/deck-facade.js';

/**
 * Turns protocol messages into calls on the deck, and results back into
 * responses.
 *
 * Transport-agnostic on purpose: it never sees a socket, so the entire API
 * surface is testable by passing objects in and reading objects out.
 */
/** Somewhere to leave a picture, in exchange for a link to it. */
export interface AssetLinker {
  link(source: string): string;
}

export interface ApiHandlerOptions {
  /**
   * Where pictures go when this handler answers over a network.
   *
   * Omitted for the desktop window, which shares a machine with the daemon and
   * can be handed a data URL for nothing. Over a socket the difference is the
   * whole page: a picture spanning fifteen keys is otherwise sent fifteen
   * times, and a seven-megabyte animation becomes a hundred megabytes.
   */
  readonly assets?: AssetLinker;
}

/** Checked here as well as typed: the name arrives as a string off a socket. */
const APP_FOLDERS: readonly AppFolder[] = ['config', 'profiles', 'plugins', 'icons'];

export class ApiHandler {
  private readonly assets?: AssetLinker;

  constructor(
    private readonly deck: DeckFacade,
    options: ApiHandlerOptions = {},
  ) {
    this.assets = options.assets;
  }

  /** Handles one parsed message. Never throws — failures become responses. */
  async handle(message: unknown): Promise<ResponseMessage> {
    if (!isRequestMessage(message)) {
      return fail('', new Error('Expected a request message with an id and a method'));
    }

    try {
      return { type: 'response', id: message.id, ok: true, result: await this.dispatch(message) };
    } catch (error) {
      return fail(message.id, error);
    }
  }

  /** Swaps every picture in a page for a link, when there is somewhere to put it. */
  private withLinks(keys: readonly KeyView[]): readonly KeyView[] {
    const assets = this.assets;
    if (!assets) return keys;

    return keys.map((view) => {
      const { backdrop, icon } = view.visual;
      if (!backdrop && !icon) return view;

      return {
        ...view,
        visual: {
          ...view.visual,
          ...(backdrop ? { backdrop: { ...backdrop, source: assets.link(backdrop.source) } } : {}),
          ...(icon ? { icon: { ...icon, source: assets.link(icon.source) } } : {}),
        },
      };
    });
  }

  private async dispatch(request: RequestMessage): Promise<unknown> {
    const params = request.params ?? {};

    /*
     * Which deck the request is about. Optional throughout: a client that
     * knows about one deck — or has not asked yet — keeps working, and the
     * daemon answers about the active one.
     */
    const deckId = typeof params['deckId'] === 'string' ? params['deckId'] : undefined;

    switch (request.method) {
      case 'getState':
        return this.deck.state();

      case 'getPageView':
        return { keys: this.withLinks(await this.deck.pageView(deckId)) };

      case 'getPlugins':
        return { plugins: await this.deck.plugins() };

      case 'getInstalledPlugins':
        return this.deck.installedPlugins();

      case 'listIcons': {
        const library = await this.deck.listIcons();
        return { icons: library.images, omitted: library.omitted };
      }

      case 'listProfiles':
        return { profiles: await this.deck.listProfiles() };

      case 'getProfile':
        return { profile: await this.deck.getProfile(text(params, 'id')) };

      case 'saveProfile': {
        const profile = params['profile'];
        if (typeof profile !== 'object' || profile === null) {
          throw new TypeError("Parameter 'profile' must be an object");
        }
        // Validated here as well as in the repository: a UI deserves the
        // reason its document was rejected, not a write that fails later.
        validateProfile(profile as ProfileDefinition);
        await this.deck.saveProfile(profile as ProfileDefinition);
        return { saved: (profile as ProfileDefinition).id };
      }

      case 'deleteProfile':
        await this.deck.deleteProfile(text(params, 'id'));
        return { deleted: text(params, 'id') };

      case 'activateProfile':
        await this.deck.activateProfile(text(params, 'id'), deckId);
        return { active: text(params, 'id') };

      case 'setVariable':
        this.deck.setVariable(text(params, 'name'), value(params, 'value'));
        return { ok: true };

      case 'deleteVariable':
        this.deck.deleteVariable(text(params, 'name'));
        return { ok: true };

      case 'openFolder':
        this.deck.openFolder(text(params, 'folderId'), deckId);
        return { ok: true };

      case 'goToPage':
        this.deck.goToPage(text(params, 'pageId'), deckId);
        return { ok: true };

      case 'goUp':
        this.deck.goUp(deckId);
        return { ok: true };

      case 'goHome':
        this.deck.goHome(deckId);
        return { ok: true };

      case 'goBack':
        this.deck.goBack(deckId);
        return { ok: true };

      case 'renameDeck':
        await this.deck.renameDeck(text(params, 'deckId'), text(params, 'name'));
        return { ok: true };

      case 'listDevices':
        return this.deck.listDevices();

      case 'approveDevice':
        await this.deck.approveDevice(text(params, 'deviceId'));
        return { ok: true };

      case 'revokeDevice':
        await this.deck.revokeDevice(text(params, 'deviceId'));
        return { ok: true };

      case 'setNetworkSettings': {
        const patch: Record<string, unknown> = {};
        for (const flag of ['networkAccess', 'networkDecks', 'extensionsApi']) {
          if (typeof params[flag] === 'boolean') patch[flag] = params[flag];
        }
        if (params['port'] !== undefined) patch['port'] = integer(params, 'port');

        await this.deck.setNetworkSettings(patch);
        return { ok: true };
      }

      case 'openAppFolder': {
        const folder = text(params, 'folder');
        if (!APP_FOLDERS.includes(folder as AppFolder)) {
          throw new TypeError(`Unknown folder '${folder}'`);
        }

        await this.deck.openAppFolder(folder as AppFolder);
        return { opened: folder };
      }

      case 'setBrightness':
        await this.deck.setBrightness(integer(params, 'percent'));
        return { ok: true };

      case 'simulateKey':
        this.deck.simulateKey(integer(params, 'key'), deckId);
        return { ok: true };

      case 'simulateLongPress':
        this.deck.simulateLongPress(integer(params, 'key'), deckId);
        return { ok: true };

      case 'simulateDoublePress':
        this.deck.simulateDoublePress(integer(params, 'key'), deckId);
        return { ok: true };

      default:
        throw new Error(`Unknown method '${request.method}'`);
    }
  }
}

function fail(id: string, error: unknown): ResponseMessage {
  const cause = error instanceof Error ? error : new Error(String(error));
  return {
    type: 'response',
    id,
    ok: false,
    error: { message: describeChain(cause), name: cause.name },
  };
}

/** Includes the cause chain: the reason is usually one link down. */
function describeChain(error: Error): string {
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && parts.length < 4) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(' <- ');
}

function text(params: Readonly<Record<string, unknown>>, name: string): string {
  const raw = params[name];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new TypeError(`Parameter '${name}' must be a non-empty string`);
  }
  return raw;
}

function integer(params: Readonly<Record<string, unknown>>, name: string): number {
  const raw = Number(params[name]);
  if (!Number.isFinite(raw)) throw new TypeError(`Parameter '${name}' must be a number`);
  return Math.round(raw);
}

function value(params: Readonly<Record<string, unknown>>, name: string): VariableValue {
  const raw = params[name];
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
    throw new TypeError(`Parameter '${name}' must be a string, number or boolean`);
  }
  return raw;
}
