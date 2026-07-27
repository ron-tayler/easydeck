import type {
  ActionDescriptor,
  ButtonDefinition,
  FolderDefinition,
  PageDefinition,
  ProfileDefinition,
} from '@easydeck/core';

/**
 * Edits a profile as a document.
 *
 * Every change produces a whole new profile and saves it, rather than calling
 * granular "add a button" methods on the deck. A profile is a JSON document;
 * treating it as one keeps the API small, makes every edit atomic, and hands
 * us undo almost for free later — a stack of documents is all it takes.
 */

/** Replaces one page wherever it lives in the tree, leaving the rest alone. */
function mapPage(
  folder: FolderDefinition,
  pageId: string,
  update: (page: PageDefinition) => PageDefinition,
): FolderDefinition {
  return {
    ...folder,
    pages: folder.pages.map((page) => (page.id === pageId ? update(page) : page)),
    folders: folder.folders?.map((child) => mapPage(child, pageId, update)),
  };
}

export function updatePage(
  profile: ProfileDefinition,
  pageId: string,
  update: (page: PageDefinition) => PageDefinition,
): ProfileDefinition {
  return { ...profile, root: mapPage(profile.root, pageId, update) };
}

/** Ids only have to be unique, but a readable one helps when editing by hand. */
export function freshId(prefix: string, taken: ReadonlySet<string>): string {
  for (let index = 1; ; index++) {
    const candidate = `${prefix}-${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Names usable in `{{…}}` templates.
 *
 * Matches the engine's own placeholder pattern, so a variable that can be
 * created is always a variable that can be shown on a key. Rejecting the rest
 * at creation beats letting someone make one they can never display.
 */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function setProfileVariable(
  profile: ProfileDefinition,
  name: string,
  value: string | number | boolean,
): ProfileDefinition {
  return { ...profile, variables: { ...profile.variables, [name]: value } };
}

export function removeProfileVariable(
  profile: ProfileDefinition,
  name: string,
): ProfileDefinition {
  const { [name]: _removed, ...rest } = profile.variables ?? {};
  return { ...profile, variables: rest };
}

/** Replaces one folder wherever it sits in the tree, root included. */
function mapFolder(
  folder: FolderDefinition,
  folderId: string,
  update: (found: FolderDefinition) => FolderDefinition,
): FolderDefinition {
  if (folder.id === folderId) return update(folder);

  return {
    ...folder,
    folders: folder.folders?.map((child) => mapFolder(child, folderId, update)),
  };
}

function collectIds(
  folder: FolderDefinition,
  into = { folders: new Set<string>(), pages: new Set<string>() },
): { folders: Set<string>; pages: Set<string> } {
  into.folders.add(folder.id);
  for (const page of folder.pages) into.pages.add(page.id);
  for (const child of folder.folders ?? []) collectIds(child, into);
  return into;
}

export function findFolder(
  folder: FolderDefinition,
  folderId: string,
): FolderDefinition | undefined {
  if (folder.id === folderId) return folder;
  for (const child of folder.folders ?? []) {
    const found = findFolder(child, folderId);
    if (found) return found;
  }
  return undefined;
}

/** The folder a page belongs to. */
export function ownerOfPage(
  folder: FolderDefinition,
  pageId: string,
): FolderDefinition | undefined {
  if (folder.pages.some((page) => page.id === pageId)) return folder;
  for (const child of folder.folders ?? []) {
    const found = ownerOfPage(child, pageId);
    if (found) return found;
  }
  return undefined;
}

/** A new scene always gets one page: a folder with none cannot be entered. */
export function addFolder(
  profile: ProfileDefinition,
  parentId: string,
  name: string,
): ProfileDefinition {
  const ids = collectIds(profile.root);
  const folder: FolderDefinition = {
    id: freshId('folder', ids.folders),
    name,
    pages: [{ id: freshId('page', ids.pages), buttons: [] }],
  };

  return {
    ...profile,
    root: mapFolder(profile.root, parentId, (parent) => ({
      ...parent,
      folders: [...(parent.folders ?? []), folder],
    })),
  };
}

export function renameFolder(
  profile: ProfileDefinition,
  folderId: string,
  name: string,
): ProfileDefinition {
  return { ...profile, root: mapFolder(profile.root, folderId, (folder) => ({ ...folder, name })) };
}

/**
 * Removes a folder and everything under it.
 *
 * The root cannot go: a profile with no scenes has nowhere to be, and the
 * caller gets its profile back unchanged rather than a broken one.
 */
export function removeFolder(profile: ProfileDefinition, folderId: string): ProfileDefinition {
  if (folderId === profile.root.id) return profile;

  const prune = (folder: FolderDefinition): FolderDefinition => ({
    ...folder,
    folders: (folder.folders ?? []).filter((child) => child.id !== folderId).map(prune),
  });

  return { ...profile, root: prune(profile.root) };
}

/** Adds a page to a scene, up to the cap. */
export function addPage(
  profile: ProfileDefinition,
  folderId: string,
  maxPages: number,
): ProfileDefinition {
  const ids = collectIds(profile.root);

  return {
    ...profile,
    root: mapFolder(profile.root, folderId, (folder) => {
      if (folder.pages.length >= maxPages) return folder;
      return {
        ...folder,
        pages: [...folder.pages, { id: freshId('page', ids.pages), buttons: [] }],
      };
    }),
  };
}

export function renamePage(
  profile: ProfileDefinition,
  pageId: string,
  name: string,
): ProfileDefinition {
  return updatePage(profile, pageId, (page) => ({ ...page, name }));
}

/**
 * Removes a page.
 *
 * A scene must keep at least one, since a folder with no pages cannot be
 * opened — deleting the last one would strand everything below it.
 */
export function removePage(profile: ProfileDefinition, pageId: string): ProfileDefinition {
  const owner = ownerOfPage(profile.root, pageId);
  if (!owner || owner.pages.length <= 1) return profile;

  return {
    ...profile,
    root: mapFolder(profile.root, owner.id, (folder) => ({
      ...folder,
      pages: folder.pages.filter((page) => page.id !== pageId),
    })),
  };
}

function allButtonIds(folder: FolderDefinition, into = new Set<string>()): Set<string> {
  for (const page of folder.pages) for (const button of page.buttons) into.add(button.id);
  for (const child of folder.folders ?? []) allButtonIds(child, into);
  return into;
}

/**
 * Puts an action on a key.
 *
 * On an empty key this creates a button; on an occupied one the action is
 * appended to what is already there. Replacing a configured button with a
 * single drag would destroy work without asking, so replacing is left to an
 * explicit choice.
 */
export function addActionToKey(
  profile: ProfileDefinition,
  pageId: string,
  key: number,
  actionType: string,
  label: string,
): ProfileDefinition {
  const taken = allButtonIds(profile.root);
  const action: ActionDescriptor = { type: actionType };

  return updatePage(profile, pageId, (page) => {
    const existing = page.buttons.find((button) => button.key === key);

    if (!existing) {
      const button: ButtonDefinition = {
        id: freshId('button', taken),
        key,
        states: [
          {
            id: 'default',
            visual: { background: '#2a2f38', label: { text: label, fontSize: 14 } },
            actions: { up: [action] },
          },
        ],
      };
      return { ...page, buttons: [...page.buttons, button] };
    }

    return {
      ...page,
      buttons: page.buttons.map((button) => {
        if (button.key !== key) return button;

        // Appended to the state that is currently on screen, which is the one
        // the user was looking at when they dropped it.
        const [first, ...rest] = button.states;
        const state = first!;
        return {
          ...button,
          states: [
            {
              ...state,
              actions: { ...state.actions, up: [...(state.actions?.up ?? []), action] },
            },
            ...rest,
          ],
        };
      }),
    };
  });
}

/** Swaps two keys. Nothing is destroyed, and dragging back undoes it. */
export function swapKeys(
  profile: ProfileDefinition,
  pageId: string,
  from: number,
  to: number,
): ProfileDefinition {
  if (from === to) return profile;

  return updatePage(profile, pageId, (page) => ({
    ...page,
    buttons: page.buttons.map((button) => {
      if (button.key === from) return { ...button, key: to };
      if (button.key === to) return { ...button, key: from };
      return button;
    }),
  }));
}

export function removeKey(
  profile: ProfileDefinition,
  pageId: string,
  key: number,
): ProfileDefinition {
  return updatePage(profile, pageId, (page) => ({
    ...page,
    buttons: page.buttons.filter((button) => button.key !== key),
  }));
}

/** What lands on the clipboard: the button, plus a marker to recognise it by. */
export interface ClipboardButton {
  readonly kind: 'easydeck/button';
  readonly version: 1;
  readonly button: ButtonDefinition;
}

export function toClipboard(button: ButtonDefinition): string {
  return JSON.stringify({ kind: 'easydeck/button', version: 1, button } satisfies ClipboardButton, null, 2);
}

/**
 * Reads a button out of pasted text.
 *
 * The clipboard can hold anything, so this refuses everything that is not
 * unmistakably one of ours instead of guessing. Being JSON means a button can
 * also travel by chat message or gist, which is the nice side effect.
 */
export function fromClipboard(text: string): ButtonDefinition | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const payload = parsed as Partial<ClipboardButton>;
  if (payload.kind !== 'easydeck/button' || typeof payload.button !== 'object') return undefined;

  const button = payload.button as ButtonDefinition;
  if (!Array.isArray(button.states) || button.states.length === 0) return undefined;

  return button;
}

/**
 * Places a copied button on a key, replacing whatever was there.
 *
 * The id is regenerated: a paste is a new button, and reusing the source's id
 * would put two buttons with the same identity in one profile.
 */
export function pasteButton(
  profile: ProfileDefinition,
  pageId: string,
  key: number,
  button: ButtonDefinition,
): ProfileDefinition {
  const id = freshId('button', allButtonIds(profile.root));

  return updatePage(profile, pageId, (page) => ({
    ...page,
    buttons: [...page.buttons.filter((existing) => existing.key !== key), { ...button, id, key }],
  }));
}
