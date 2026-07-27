import type { KeyView, ProfileDefinition, VariableValue } from '@easydeck/engine';

import type { DeckState } from '../../domain/api-messages.js';
import type { DeckEvents } from './deck-events.js';
import type { ProfileSummary } from './repositories.js';

/**
 * Everything the API is allowed to do, as one interface.
 *
 * The request handler talks to this rather than to the live deck, so the
 * whole protocol layer can be tested against a few lines of fake — no device,
 * no renderer, no sockets.
 */
export interface DeckFacade {
  state(): Promise<DeckState>;
  /** The current page, resolved — what each key is showing right now. */
  pageView(): Promise<readonly KeyView[]>;

  listProfiles(): Promise<ProfileSummary[]>;
  getProfile(id: string): Promise<ProfileDefinition>;
  saveProfile(profile: ProfileDefinition): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  activateProfile(id: string): Promise<void>;

  setVariable(name: string, value: VariableValue): void;
  goToPage(pageId: string): void;
  setBrightness(percent: number): Promise<void>;
  /** Runs a key's actions as if it had been pressed, for testing from a UI. */
  simulateKey(key: number): void;
}

/**
 * What the API server needs: the operations plus the event stream.
 *
 * Satisfied both by a live `DeckService` and by a host that owns one and
 * outlives it, which is what lets the API keep serving across a lock cycle.
 */
export interface ApiSource extends DeckFacade {
  /**
   * Subscribes to deck events.
   *
   * An explicit method rather than the emitter's own `on`: Node types that
   * one through a conditional the compiler cannot narrow while the event
   * parameter is still generic, so requiring it here would make every
   * implementation fail to satisfy the interface.
   */
  onDeckEvent<E extends keyof DeckEvents>(event: E, listener: (...args: DeckEvents[E]) => void): void;
}
