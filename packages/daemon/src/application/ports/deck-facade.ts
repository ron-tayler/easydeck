import type { ProfileDefinition, VariableValue } from '@easydeck/engine';

import type { DeckState } from '../../domain/api-messages.js';
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
