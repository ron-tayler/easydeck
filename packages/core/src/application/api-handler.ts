import { validateProfile } from '@easydeck/engine';
import type { ProfileDefinition, VariableValue } from '@easydeck/engine';

import type { RequestMessage, ResponseMessage } from '../domain/api-messages.js';
import { isRequestMessage } from '../domain/api-messages.js';
import type { DeckFacade } from './ports/deck-facade.js';

/**
 * Turns protocol messages into calls on the deck, and results back into
 * responses.
 *
 * Transport-agnostic on purpose: it never sees a socket, so the entire API
 * surface is testable by passing objects in and reading objects out.
 */
export class ApiHandler {
  constructor(private readonly deck: DeckFacade) {}

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

  private async dispatch(request: RequestMessage): Promise<unknown> {
    const params = request.params ?? {};

    switch (request.method) {
      case 'getState':
        return this.deck.state();

      case 'getPageView':
        return { keys: await this.deck.pageView() };

      case 'getPlugins':
        return { plugins: await this.deck.plugins() };

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
        await this.deck.activateProfile(text(params, 'id'));
        return { active: text(params, 'id') };

      case 'setVariable':
        this.deck.setVariable(text(params, 'name'), value(params, 'value'));
        return { ok: true };

      case 'openFolder':
        this.deck.openFolder(text(params, 'folderId'));
        return { ok: true };

      case 'goToPage':
        this.deck.goToPage(text(params, 'pageId'));
        return { ok: true };

      case 'goUp':
        this.deck.goUp();
        return { ok: true };

      case 'goHome':
        this.deck.goHome();
        return { ok: true };

      case 'goBack':
        this.deck.goBack();
        return { ok: true };

      case 'setBrightness':
        await this.deck.setBrightness(integer(params, 'percent'));
        return { ok: true };

      case 'simulateKey':
        this.deck.simulateKey(integer(params, 'key'));
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
