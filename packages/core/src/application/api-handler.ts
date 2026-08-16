import { drawableIcon, validateProfile } from '@easydeck/engine';
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
          /*
           * A parametric icon is substituted into before it is filed.
           *
           * What travels to a client is a link, and there is nothing to
           * substitute into a link — so the values have to be in the picture
           * by the time it becomes one. Each value is then its own asset with
           * its own address, which is exactly what the immutable cache wants:
           * a needle at 38% is a different picture from the same needle at
           * 39%, and a needle that returns to 38% is fetched from the cache.
           */
          ...(icon ? { icon: { ...icon, source: assets.link(drawableIcon(icon)) } } : {}),
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
        /*
         * Statuses ride along with the list.
         *
         * They change on their own and arrive by event afterwards, but a
         * window that has just opened has heard no events yet — without this
         * every lamp reads "not running" until the next time something
         * happens to a plugin, which for a working OBS could be never.
         */
        return { plugins: await this.deck.plugins(), statuses: this.deck.pluginStatuses() };

      case 'getInstalledPlugins':
        return this.deck.installedPlugins();

      // --- the store ------------------------------------------------------

      case 'getStorePlugins':
        return { plugins: await this.deck.storePlugins({ refresh: params['refresh'] === true }) };

      /*
       * One plugin in full, for its card.
       *
       * The list carries a row's worth each; this is the rest, asked for when
       * somebody opens one — see the facade for why they are apart.
       */
      case 'getStorePlugin':
        return { manifest: await this.deck.storePlugin(text(params, 'pluginId')) };

      /*
       * One picture, asked for by reference.
       *
       * Apart from the list on purpose: a cover is small and a screenshot is
       * not, and a store that sent every picture of every plugin to draw a
       * list of names would be slow on the one screen that must not be.
       */
      case 'getStoreImage':
        return {
          image: await this.deck.storeImage(text(params, 'pluginId'), text(params, 'reference')),
        };

      case 'installPlugin':
        await this.deck.installPlugin(text(params, 'pluginId'), {
          replace: params['replace'] === true,
        });
        return { ok: true };

      case 'installPluginArchive':
        return {
          pluginId: await this.deck.installPluginArchive(text(params, 'base64'), {
            replace: params['replace'] === true,
          }),
        };

      case 'removePlugin':
        await this.deck.removePlugin(text(params, 'pluginId'));
        return { ok: true };

      /*
       * One frame of a widget, for the editor to show while it is being set up.
       *
       * A picture that is different every second cannot be chosen blind:
       * somebody picking the colour of a graph has to see the graph. The same
       * call the panel makes, answered for a window instead.
       */
      case 'drawSurface': {
        const request = params as { type?: string; params?: Record<string, unknown> };
        if (!request.type) throw new TypeError('drawSurface needs a type');
        return {
          frame: await this.deck.drawSurface({
            type: request.type,
            params: request.params ?? {},
            cols: 1,
            rows: 1,
            buttons: [],
          }),
        };
      }

      /*
       * The declaration of a field whose type is only knowable now.
       *
       * Answers `shapeFrom`: the form asks what shape this field should take
       * given what has been filled in, and gets back a whole parameter
       * definition rather than a list of choices.
       */
      case 'paramShape':
        return {
          shape: await this.deck.paramShape(
            text(params, 'source'),
            (params['params'] as Record<string, unknown>) ?? {},
          ),
        };

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
        // Answered with where it actually landed: renaming a profile renames
        // its folder, so a client that assumed the id it sent would be holding
        // one that no longer exists.
        const { id } = await this.deck.saveProfile(profile as ProfileDefinition);
        return { saved: id };
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

      case 'exportProfile':
        return this.deck.exportProfile(text(params, 'profileId'));

      case 'importProfile':
        return this.deck.importProfile(text(params, 'archive'));

      /*
       * Passwords travel one way only.
       *
       * `listButtonSecrets` answers with references that have something behind
       * them, never with a value; there is deliberately no call that reads one
       * back. A configurator that cannot receive a password cannot leak one,
       * and it has no use for it — the control it draws is a row of dots.
       */
      case 'listButtonSecrets':
        return { secrets: await this.deck.buttonSecrets() };

      case 'saveButtonSecret': {
        const reference = params['reference'];
        return this.deck.saveButtonSecret(
          text(params, 'value'),
          typeof reference === 'string' ? reference : undefined,
        );
      }

      case 'clearButtonSecret':
        await this.deck.clearButtonSecret(text(params, 'reference'));
        return { ok: true };

      case 'getPluginSettings':
        return this.deck.pluginSettings(text(params, 'pluginId'));

      case 'savePluginSettings': {
        const values = params['values'];
        if (typeof values !== 'object' || values === null || Array.isArray(values)) {
          throw new TypeError('savePluginSettings needs an object of values');
        }

        await this.deck.savePluginSettings(
          text(params, 'pluginId'),
          values as Record<string, VariableValue>,
        );
        return { ok: true };
      }

      case 'runPluginCommand':
        await this.deck.runPluginCommand(text(params, 'pluginId'), text(params, 'command'));
        return { ok: true };

      case 'getActionOptions': {
        const filled = params['params'];
        return {
          options: await this.deck.pluginOptions(
            text(params, 'pluginId'),
            text(params, 'source'),
            typeof filled === 'object' && filled !== null && !Array.isArray(filled)
              ? (filled as Record<string, unknown>)
              : {},
          ),
        };
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
