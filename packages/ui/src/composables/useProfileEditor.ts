import type {
  ActionDescriptor,
  ButtonDefinition,
  FolderDefinition,
  PageDefinition,
  PresetButton,
  ProfileDefinition,
  VariableDeclaration,
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

/**
 * Adds a variable, or edits the one already declared under that name.
 *
 * Declaring rather than just storing a value is what lets a button bound to it
 * behave sensibly: the type decides whether states are matched, counted
 * through or flipped.
 */
export function setProfileVariable(
  profile: ProfileDefinition,
  declaration: VariableDeclaration,
): ProfileDefinition {
  const existing = profile.variables ?? [];
  const at = existing.findIndex((variable) => variable.name === declaration.name);

  // Edited in place rather than appended, so renaming a type or a default does
  // not shuffle the list under the user mid-edit.
  const variables =
    at === -1
      ? [...existing, declaration]
      : existing.map((variable, index) => (index === at ? declaration : variable));

  return { ...profile, variables };
}

export function removeProfileVariable(
  profile: ProfileDefinition,
  name: string,
): ProfileDefinition {
  return {
    ...profile,
    variables: (profile.variables ?? []).filter((variable) => variable.name !== name),
  };
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

/** Where a dragged folder lands relative to the one it was dropped on. */
export type FolderDrop = 'before' | 'after' | 'inside';

/**
 * Moves a folder somewhere else in the tree.
 *
 * Reordering and re-nesting are the same operation — a folder's place *is* its
 * position in some parent's list — so one function does both, and the caller
 * says which by naming a folder to land next to or inside.
 *
 * A folder cannot be put inside itself or anything under it: the branch would
 * leave the tree holding its own parent, and everything on it would be lost.
 * That, and a move of the root, give the profile back unchanged rather than a
 * broken one.
 */
export function moveFolder(
  profile: ProfileDefinition,
  folderId: string,
  targetId: string,
  drop: FolderDrop,
): ProfileDefinition {
  if (folderId === profile.root.id || folderId === targetId) return profile;

  const moved = findFolder(profile.root, folderId);
  if (!moved || !findFolder(profile.root, targetId)) return profile;
  if (findFolder(moved, targetId)) return profile;

  // The root has no siblings to sit between, so landing on it can only mean
  // inside it.
  const where = targetId === profile.root.id ? 'inside' : drop;

  /*
   * Taken out first, then put back. Doing it in that order is what makes a
   * move within one list come out right: by the time the position is worked
   * out, the folder is no longer in the list to be counted.
   */
  const detached = removeFolder(profile, folderId).root;

  const place = (folder: FolderDefinition): FolderDefinition => {
    const children = (folder.folders ?? []).map(place);

    if (where === 'inside') {
      return folder.id === targetId
        ? { ...folder, folders: [...children, moved] }
        : withFolders(folder, children);
    }

    const at = children.findIndex((child) => child.id === targetId);
    if (at === -1) return withFolders(folder, children);

    const insertAt = where === 'before' ? at : at + 1;
    return {
      ...folder,
      folders: [...children.slice(0, insertAt), moved, ...children.slice(insertAt)],
    };
  };

  return { ...profile, root: place(detached) };
}

/** Keeps a childless folder childless, rather than leaving `folders: []` behind. */
function withFolders(
  folder: FolderDefinition,
  children: readonly FolderDefinition[],
): FolderDefinition {
  if (children.length === 0) {
    const { folders: _none, ...rest } = folder;
    return rest;
  }
  return { ...folder, folders: children };
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
            actions: { press: [action] },
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
              actions: { ...state.actions, press: [...(state.actions?.press ?? []), action] },
            },
            ...rest,
          ],
        };
      }),
    };
  });
}

/**
 * Puts a plugin's ready-made key on the deck.
 *
 * Unlike an action, a preset is a whole button, so there is nothing sensible
 * to append it to: an occupied key is replaced, and asking first is the
 * caller's job. What lands is an ordinary button — its states, colours and
 * bands are the plugin's suggestion and the user's to edit afterwards, and
 * nothing in the profile remembers where it came from.
 */
export function addPresetToKey(
  profile: ProfileDefinition,
  pageId: string,
  key: number,
  preset: PresetButton,
): ProfileDefinition {
  const taken = allButtonIds(profile.root);

  return updatePage(profile, pageId, (page) => {
    const button: ButtonDefinition = { ...preset, id: freshId('button', taken), key };

    return {
      ...page,
      buttons: [...page.buttons.filter((each) => each.key !== key), button],
    };
  });
}

/** Swaps two keys. Nothing is destroyed, and dragging back undoes it. */
/**
 * Stretches a button's picture over a rectangle of keys, or un-merges it.
 *
 * A span of one is stored as nothing at all: the absence of a merge should
 * look like the absence of a merge in the document, not like a merge of size
 * one that happens to behave the same.
 */
export function setButtonSpan(
  profile: ProfileDefinition,
  pageId: string,
  key: number,
  colSpan: number,
  rowSpan: number,
): ProfileDefinition {
  return updatePage(profile, pageId, (page) => ({
    ...page,
    buttons: page.buttons.map((button) =>
      button.key === key
        ? {
            ...button,
            colSpan: colSpan > 1 ? colSpan : undefined,
            rowSpan: rowSpan > 1 ? rowSpan : undefined,
          }
        : button,
    ),
  }));
}

/**
 * Moves a button to another key, trading places with whatever was there.
 *
 * A stretched button carries its rectangle with it, and the rectangle may not
 * fit where it lands — three columns wide dropped on the last column has
 * nowhere to go. It is trimmed to what fits rather than refused: the move is
 * what was asked for, and a button quietly not moving is harder to understand
 * than one that arrives smaller.
 *
 * The old size is not remembered. Dragging back gives a button of the size it
 * has now, which is visible and easy to correct — a size that springs back
 * would be a rule nobody can see.
 */
export function swapKeys(
  profile: ProfileDefinition,
  pageId: string,
  from: number,
  to: number,
  layout?: { readonly rows: number; readonly cols: number },
): ProfileDefinition {
  if (from === to) return profile;

  return updatePage(profile, pageId, (page) => ({
    ...page,
    buttons: page.buttons.map((button) => {
      if (button.key === from) return trimToGrid({ ...button, key: to }, layout);
      if (button.key === to) return trimToGrid({ ...button, key: from }, layout);
      return button;
    }),
  }));
}

/** Cuts a button's rectangle down to what the grid can hold from its new key. */
function trimToGrid(
  button: ButtonDefinition,
  layout: { readonly rows: number; readonly cols: number } | undefined,
): ButtonDefinition {
  if (!layout) return button;

  const column = button.key % layout.cols;
  const row = Math.floor(button.key / layout.cols);

  const colSpan = Math.min(button.colSpan ?? 1, layout.cols - column);
  const rowSpan = Math.min(button.rowSpan ?? 1, layout.rows - row);

  return {
    ...button,
    colSpan: colSpan > 1 ? colSpan : undefined,
    rowSpan: rowSpan > 1 ? rowSpan : undefined,
  };
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

/**
 * A button with nothing on it: no colour, no label, no behaviour.
 *
 * Deliberately blank rather than pre-filled — it exists so the editor has
 * something to open, and anything we invented here would only have to be
 * cleared again.
 */
export function createEmptyButton(profile: ProfileDefinition, key: number): ButtonDefinition {
  return {
    id: freshId('button', allButtonIds(profile.root)),
    key,
    states: [{ id: 'default', visual: {} }],
  };
}

/** Puts an edited button back where it came from. */
export function replaceButton(
  profile: ProfileDefinition,
  pageId: string,
  button: ButtonDefinition,
): ProfileDefinition {
  return updatePage(profile, pageId, (page) => ({
    ...page,
    buttons: page.buttons.some((existing) => existing.id === button.id)
      ? page.buttons.map((existing) => (existing.id === button.id ? button : existing))
      : [...page.buttons, button],
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
