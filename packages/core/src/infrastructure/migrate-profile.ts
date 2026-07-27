import { PROFILE_FORMAT_VERSION, inferVariableType } from '@easydeck/engine';
import type { ProfileDefinition, VariableValue } from '@easydeck/engine';

/**
 * Brings a stored profile up to the current format.
 *
 * Profiles are user data living in a folder people are encouraged to edit by
 * hand, so an upgrade must never be a reason for someone's deck to stop
 * working. Migration happens on read and the file is rewritten only when it
 * is next saved.
 */
export function migrateProfile(raw: unknown): ProfileDefinition {
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('A profile must be an object');
  }

  const document = raw as Record<string, unknown>;
  const version = Number(document['formatVersion'] ?? 1);

  if (version >= PROFILE_FORMAT_VERSION) return document as unknown as ProfileDefinition;

  // Each step upgrades by one, so a version 1 file walks the same path a
  // version 2 file takes — there is only ever one migration to reason about.
  const v2 = version < 2 ? migrateV1ToV2(document) : (document as unknown as ProfileDefinition);
  return migrateV2ToV3(v2 as unknown as Record<string, unknown>);
}

/**
 * Version 2 stored variables as a plain name-to-value map.
 *
 * Version 3 declares them instead, because a value alone cannot say how a
 * button bound to it should behave. The type is inferred from the value that
 * was there, which is the only honest guess available and matches what the
 * engine did implicitly before types existed.
 */
function migrateV2ToV3(document: Record<string, unknown>): ProfileDefinition {
  const stored = document['variables'];
  const declarations =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored)
      ? Object.entries(stored as Record<string, VariableValue>).map(([name, initial]) => ({
          name,
          type: inferVariableType(initial),
          initial,
        }))
      : ((stored ?? []) as ProfileDefinition['variables']);

  return {
    ...(document as unknown as ProfileDefinition),
    formatVersion: PROFILE_FORMAT_VERSION,
    variables: declarations,
  };
}

/**
 * Version 1 named actions without a plugin, before everything became one.
 *
 * Renaming them is as much a part of the migration as reshaping the tree: a
 * profile whose structure is upgraded but whose actions still say `open`
 * would load cleanly and then fail on the first press, which is a far worse
 * outcome than refusing it outright.
 */
const V1_ACTION_TYPES: Readonly<Record<string, string>> = {
  'go-to-page': 'easydeck.go-to-page',
  'set-variable': 'easydeck.set-variable',
  'toggle-variable': 'easydeck.toggle-variable',
  'increment-variable': 'easydeck.increment-variable',
  'cycle-variable': 'easydeck.cycle-variable',
  'set-button-state': 'easydeck.set-button-state',
  delay: 'easydeck.delay',
  'run-program': 'system.run-program',
  open: 'system.open',
  'http-request': 'http.request',
  'set-brightness': 'deck.set-brightness',
  'sleep-panel': 'deck.sleep-panel',
  'wake-panel': 'deck.wake-panel',
  hotkey: 'keyboard.hotkey',
  'type-text': 'keyboard.type-text',
};

/**
 * Version 1 had a flat list of pages and no folders.
 *
 * Those pages become the pages of the root scene, which is exactly what they
 * were: one profile, one set of screens. Nothing is lost and no button moves.
 */
function migrateV1ToV2(document: Record<string, unknown>): ProfileDefinition {
  const pages = Array.isArray(document['pages']) ? document['pages'] : [];
  const { pages: _dropped, initialPageId, ...rest } = document as Record<string, unknown> & {
    pages?: unknown;
    initialPageId?: unknown;
  };

  return {
    ...(rest as unknown as Omit<ProfileDefinition, 'formatVersion' | 'root'>),
    formatVersion: PROFILE_FORMAT_VERSION,
    root: {
      id: 'root',
      name: typeof document['name'] === 'string' ? document['name'] : 'Root',
      pages: renameActions(pages) as ProfileDefinition['root']['pages'],
    },
    initialPageId: typeof initialPageId === 'string' ? initialPageId : undefined,
  };
}

/** Rewrites every action type in place, leaving unknown ones untouched. */
function renameActions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameActions);
  if (typeof value !== 'object' || value === null) return value;

  const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (key === 'type' && typeof item === 'string') return [key, V1_ACTION_TYPES[item] ?? item];
    return [key, renameActions(item)];
  });

  return Object.fromEntries(entries);
}
