import type {
  DeckLocation,
  KeyView,
  LocalizedText,
  PluginStatus,
  VariableValue,
} from '@easydeck/engine';

import type { DeckState } from '@easydeck/protocol';

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
  /*
   * Everything that happens *to a deck* names it. With several running, a
   * configurator showing one of them must be able to tell which events are
   * about the deck it is showing — otherwise pressing a key on the panel
   * lights up the same key in a window displaying the tablet.
   */
  locationChanged: [event: { deckId: string; location: DeckLocation }];
  /**
   * The panel was repainted, with the keys that were written.
   *
   * A configurator mirroring the deck needs to follow this rather than guess
   * from variable changes: a button state can also move through
   * set-button-state, which touches no variable at all. Reporting the repaint
   * itself means the window cannot drift from the device.
   */
  viewChanged: [event: { deckId: string; keys: readonly number[]; views: readonly KeyView[] }];
  /** Variables belong to the machine, so this one names no deck. */
  variablesChanged: [variables: Record<string, VariableValue>];
  keyDown: [event: { deckId: string; key: number }];
  keyUp: [event: { deckId: string; key: number }];
  profilesChanged: [];
  /** A device was approved, revoked, or has started asking to be let in. */
  devicesChanged: [];
  actionError: [message: string];
  /**
   * A plugin connected, lost its connection, or gave up.
   *
   * Its own event rather than part of the state: a plugin reconnecting in the
   * background must not make a configurator redraw everything it is showing,
   * and the gear beside the plugin is the only thing that changed.
   */
  pluginStatusChanged: [
    event: { pluginId: string; status: PluginStatus; message?: LocalizedText },
  ];
}
