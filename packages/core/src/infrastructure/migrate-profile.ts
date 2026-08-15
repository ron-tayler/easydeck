import { PROFILE_FORMAT_VERSION, inferVariableType } from '@easydeck/engine';
import type {
  ActionDescriptor,
  FolderDefinition,
  ProfileDefinition,
  VariableValue,
} from '@easydeck/engine';

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
  const v3 =
    version < 3 ? migrateV2ToV3(v2 as unknown as Record<string, unknown>) : (v2 as ProfileDefinition);
  const v4 = version < 4 ? migrateV3ToV4(v3) : v3;
  const v5 = version < 5 ? migrateV4ToV5(v4) : v4;
  const v6 = version < 6 ? migrateV5ToV6(v5) : v5;
  return migrateV6ToV7(v6);
}

/**
 * Version 7 walks four plugins out of the box: `obs.` becomes `ed.obs.`, and
 * likewise vts, soundpad and yandex.
 *
 * Plugin ids grew an author when plugins moved to their own repository — see
 * docs/plugin-distribution.md — and a profile is full of the old names:
 * action types, surface types, the variables keys bind to and labels
 * substitute. Renamed here once, so a key that said `{{obs.scene}}` keeps
 * saying the scene rather than going blank the day the plugin arrives from
 * the store instead of the box.
 */
function migrateV6ToV7(profile: ProfileDefinition): ProfileDefinition {
  return {
    ...(renamePluginPrefixes(profile) as ProfileDefinition),
    formatVersion: PROFILE_FORMAT_VERSION,
  };
}

/** The four that moved out, old prefix to new. */
const V6_PLUGIN_IDS: Readonly<Record<string, string>> = {
  obs: 'ed.obs',
  vts: 'ed.vts',
  soundpad: 'ed.soundpad',
  yandex: 'ed.yandex',
};

/** `{{obs.scene}}` wherever it appears, spacing preserved. */
const V6_TEMPLATE = new RegExp(`\\{\\{(\\s*)(${Object.keys(V6_PLUGIN_IDS).join('|')})(?=\\.)`, 'g');

/**
 * Renames the prefixes everywhere a profile stores one.
 *
 * The knowledge of *where* is the point of this function: `type` names an
 * action or a widget's picture, `stateFrom` and an icon's `variable` bind
 * keys, a condition keeps its variable under `name` beside `source`, and any
 * text at all may substitute `{{obs.…}}`. What is deliberately left alone is
 * every other string — a page named "yandex.ru links" is somebody's name for
 * a page, not a reference.
 */
function renamePluginPrefixes(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => renamePluginPrefixes(item));

  if (typeof value === 'string') {
    const direct = key === 'type' || key === 'stateFrom' || key === 'variable';
    const renamed = direct ? withNewPrefix(value) : value;
    return renamed.replace(V6_TEMPLATE, (_, spacing: string, id: string) => `{{${spacing}${V6_PLUGIN_IDS[id]}`);
  }

  if (typeof value !== 'object' || value === null) return value;

  const record = value as Record<string, unknown>;
  const entries = Object.entries(record).map(([name, item]) => [name, renamePluginPrefixes(item, name)]);
  const rebuilt = Object.fromEntries(entries) as Record<string, unknown>;

  // A condition names its variable under `name`, which is too common a key to
  // rewrite blindly — the `source` beside it is what says it is a variable.
  if (record['source'] === 'variable' && typeof rebuilt['name'] === 'string') {
    rebuilt['name'] = withNewPrefix(rebuilt['name']);
  }

  return rebuilt;
}

function withNewPrefix(value: string): string {
  const dot = value.indexOf('.');
  if (dot <= 0) return value;
  const renamed = V6_PLUGIN_IDS[value.slice(0, dot)];
  return renamed === undefined ? value : `${renamed}${value.slice(dot)}`;
}

/**
 * Version 6 gives a script blocks, and a button one script by default.
 *
 * Two changes, both of which would silently alter what somebody's deck does if
 * they were left to the reader.
 *
 * Waiting stops being an action of the system plugin and becomes part of a
 * script, because every script wants it and it is punctuation between steps
 * rather than an errand. Same parameter, new name.
 *
 * And a button's first state becomes the one that holds the script: the others
 * follow it unless they say otherwise. Every state used to carry its own, so
 * each one that has actions is marked as having its own — the flag is written
 * in rather than assumed, so a profile written before this keeps doing exactly
 * what it did.
 */
function migrateV5ToV6(profile: ProfileDefinition): ProfileDefinition {
  const renamed = renameActions(profile, V5_ACTION_TYPES) as ProfileDefinition;

  return {
    ...renamed,
    root: markOwnActions(renamed.root),
    formatVersion: PROFILE_FORMAT_VERSION,
  };
}

const V5_ACTION_TYPES: Readonly<Record<string, string>> = {
  'system.delay': 'core.delay',
};

/** Walks the tree marking every state that already had a script of its own. */
function markOwnActions(folder: FolderDefinition): FolderDefinition {
  return {
    ...folder,
    pages: folder.pages.map((page) => ({
      ...page,
      buttons: page.buttons.map((button) => ({
        ...button,
        states: button.states.map((state, index) => {
          // The first state is the button's script; it needs no flag.
          if (index === 0) return state;
          const scripts = Object.values(state.actions ?? {}) as (readonly ActionDescriptor[] | undefined)[];
          const hasScript = scripts.some((list) => (list?.length ?? 0) > 0);
          return hasScript ? { ...state, ownActions: true } : state;
        }),
      })),
    })),
    ...(folder.folders ? { folders: folder.folders.map(markOwnActions) } : {}),
  };
}

/**
 * Version 4 kept variables, waiting and the keyboard in whichever plugin they
 * were first written into; version 5 puts them where a person would look.
 *
 * Only names change, and only the ones that moved — navigation keeps its
 * `easydeck.` prefix because it never left. A rename is not cosmetic here: a
 * plugin owns every action type beginning with its id, so an action stored
 * under a plugin that no longer claims it would load and then fail on the
 * first press.
 */
function migrateV4ToV5(profile: ProfileDefinition): ProfileDefinition {
  return {
    ...(renameActions(profile, V4_ACTION_TYPES) as ProfileDefinition),
    formatVersion: PROFILE_FORMAT_VERSION,
  };
}

/** What moved between version 4 and version 5, old name to new. */
const V4_ACTION_TYPES: Readonly<Record<string, string>> = {
  'easydeck.set-variable': 'vars.set-variable',
  'easydeck.toggle-variable': 'vars.toggle-variable',
  'easydeck.increment-variable': 'vars.increment-variable',
  'easydeck.cycle-variable': 'vars.cycle-variable',
  'easydeck.set-button-state': 'vars.set-button-state',
  'easydeck.delay': 'system.delay',
  'easydeck.open-config-folder': 'system.open-config-folder',
  'easydeck.open-profiles-folder': 'system.open-profiles-folder',
  'easydeck.open-plugins-folder': 'system.open-plugins-folder',
  'easydeck.open-icons-folder': 'system.open-icons-folder',
  'keyboard.hotkey': 'system.hotkey',
  'keyboard.type-text': 'system.type-text',
};

/**
 * Version 3 bound actions to the raw press and release; version 4 binds them
 * to gestures.
 *
 * Both of the old triggers become `press`, in the order the device would have
 * run them — a button with something on each ran its `down` actions first.
 * Merging rather than dropping one is the only choice that keeps a
 * push-to-talk button doing something, even though what it does changes:
 * bracketing a hold is not expressible any more, and pretending otherwise
 * would be worse than a button that talks when tapped.
 */
function migrateV3ToV4(profile: ProfileDefinition): ProfileDefinition {
  const migrateActions = (actions: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (!actions) return actions;

    const { down, up, ...rest } = actions as Record<string, readonly unknown[] | undefined>;
    if (down === undefined && up === undefined) return actions;

    const press = [...(down ?? []), ...(up ?? []), ...((rest['press'] as readonly unknown[]) ?? [])];
    return { ...rest, ...(press.length > 0 ? { press } : {}) };
  };

  const migrateFolder = <T extends { pages?: readonly unknown[]; folders?: readonly unknown[] }>(
    folder: T,
  ): T => ({
    ...folder,
    pages: (folder.pages ?? []).map((page) => {
      const typed = page as { buttons?: readonly unknown[] };
      return {
        ...typed,
        buttons: (typed.buttons ?? []).map((button) => {
          const withStates = button as { states?: readonly unknown[] };
          return {
            ...withStates,
            states: (withStates.states ?? []).map((state) => {
              const typedState = state as { actions?: Record<string, unknown> };
              const actions = migrateActions(typedState.actions);
              return actions === undefined ? state : { ...typedState, actions };
            }),
          };
        }),
      };
    }),
    folders: (folder.folders ?? []).map((child) => migrateFolder(child as T)),
  });

  return {
    ...profile,
    root: migrateFolder(profile.root as never) as ProfileDefinition['root'],
    formatVersion: PROFILE_FORMAT_VERSION,
  };
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
      pages: renameActions(pages, V1_ACTION_TYPES) as ProfileDefinition['root']['pages'],
    },
    initialPageId: typeof initialPageId === 'string' ? initialPageId : undefined,
  };
}

/** Rewrites every action type in place, leaving unknown ones untouched. */
function renameActions(value: unknown, table: Readonly<Record<string, string>>): unknown {
  if (Array.isArray(value)) return value.map((item) => renameActions(item, table));
  if (typeof value !== 'object' || value === null) return value;

  const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (key === 'type' && typeof item === 'string') return [key, table[item] ?? item];
    return [key, renameActions(item, table)];
  });

  return Object.fromEntries(entries);
}
