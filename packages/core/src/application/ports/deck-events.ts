import type { VariableValue } from '@easydeck/engine';

import type { DeckState } from '../../domain/api-messages.js';

/**
 * Everything a running deck reports about itself.
 *
 * Declared apart from the class that emits it so that whoever hosts the deck
 * can re-emit the same set. The API is then bound to the host rather than to
 * one deck instance, which matters because a deck comes and goes — released
 * when the workstation locks, rebuilt when it unlocks — while the host and
 * its connected clients stay put.
 */
export interface DeckEvents {
  state: [state: DeckState];
  pageChanged: [pageId: string];
  variablesChanged: [variables: Record<string, VariableValue>];
  keyDown: [key: number];
  keyUp: [key: number];
  profilesChanged: [];
  actionError: [message: string];
}
