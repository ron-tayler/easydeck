import { BUTTON_EVENTS } from './action.js';
import { InvalidProfileError } from './errors.js';
import { MAX_PAGES_PER_FOLDER } from './profile.js';
import type { FolderDefinition, ProfileDefinition } from './profile.js';

/**
 * Checks a profile document before anything tries to run it.
 *
 * Profiles arrive as JSON from disk or from the configurator, so every
 * assumption the controller makes is verified here once, loudly, instead of
 * failing later as a confusing runtime error on a single key press.
 */
export function validateProfile(profile: ProfileDefinition): void {
  const { rows, cols } = profile.layout ?? {};
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new InvalidProfileError(`Profile '${profile.id}' has an invalid layout`);
  }

  if (!profile.root || typeof profile.root !== 'object') {
    throw new InvalidProfileError(`Profile '${profile.id}' has no root folder`);
  }

  // Ids are checked across the whole tree, not per level: navigation actions
  // reference them globally, so a duplicate anywhere is ambiguous.
  const seen = { folders: new Set<string>(), pages: new Set<string>() };
  validateFolder(profile.root, rows * cols, seen, `${rows}x${cols}`);

  if (profile.initialFolderId && !seen.folders.has(profile.initialFolderId)) {
    throw new InvalidProfileError(
      `Profile '${profile.id}' starts in folder '${profile.initialFolderId}', which does not exist`,
    );
  }
  if (profile.initialPageId && !seen.pages.has(profile.initialPageId)) {
    throw new InvalidProfileError(
      `Profile '${profile.id}' starts on page '${profile.initialPageId}', which does not exist`,
    );
  }
}

function validateFolder(
  folder: FolderDefinition,
  keyCount: number,
  seen: { folders: Set<string>; pages: Set<string> },
  layoutLabel: string,
): void {
  if (!folder.id) throw new InvalidProfileError('Every folder needs an id');
  if (seen.folders.has(folder.id)) {
    throw new InvalidProfileError(`Duplicate folder id '${folder.id}'`);
  }
  seen.folders.add(folder.id);

  if (!Array.isArray(folder.pages) || folder.pages.length === 0) {
    throw new InvalidProfileError(`Folder '${folder.id}' has no pages`);
  }
  if (folder.pages.length > MAX_PAGES_PER_FOLDER) {
    throw new InvalidProfileError(
      `Folder '${folder.id}' has ${folder.pages.length} pages; the maximum is ${MAX_PAGES_PER_FOLDER}`,
    );
  }

  for (const page of folder.pages) {
    if (!page.id) throw new InvalidProfileError(`Folder '${folder.id}' has a page without an id`);
    if (seen.pages.has(page.id)) throw new InvalidProfileError(`Duplicate page id '${page.id}'`);
    seen.pages.add(page.id);

    validateButtons(page.id, page.buttons ?? [], keyCount, layoutLabel);
  }

  for (const child of folder.folders ?? []) {
    validateFolder(child, keyCount, seen, layoutLabel);
  }
}

function validateButtons(
  pageId: string,
  buttons: readonly ProfileDefinition['root']['pages'][number]['buttons'][number][],
  keyCount: number,
  layoutLabel: string,
): void {
  const buttonIds = new Set<string>();
  const usedKeys = new Set<number>();

  for (const button of buttons) {
    if (!button.id) throw new InvalidProfileError(`Page '${pageId}' has a button without an id`);
    if (buttonIds.has(button.id)) {
      throw new InvalidProfileError(`Duplicate button id '${button.id}' on page '${pageId}'`);
    }
    buttonIds.add(button.id);

    if (!Number.isInteger(button.key) || button.key < 0 || button.key >= keyCount) {
      throw new InvalidProfileError(
        `Button '${button.id}' sits on key ${button.key}, outside a ${layoutLabel} layout`,
      );
    }
    if (usedKeys.has(button.key)) {
      throw new InvalidProfileError(
        `Key ${button.key} on page '${pageId}' is claimed by more than one button`,
      );
    }
    usedKeys.add(button.key);

    if (!Array.isArray(button.states) || button.states.length === 0) {
      throw new InvalidProfileError(`Button '${button.id}' has no states`);
    }

    const stateIds = new Set<string>();
    for (const state of button.states) {
      if (!state.id) throw new InvalidProfileError(`Button '${button.id}' has a state without an id`);
      if (stateIds.has(state.id)) {
        throw new InvalidProfileError(`Duplicate state id '${state.id}' on button '${button.id}'`);
      }
      stateIds.add(state.id);

      for (const event of Object.keys(state.actions ?? {})) {
        if (!BUTTON_EVENTS.includes(event as never)) {
          throw new InvalidProfileError(
            `Button '${button.id}' binds actions to unknown event '${event}'`,
          );
        }
      }
    }

    if (button.initialStateId && !stateIds.has(button.initialStateId)) {
      throw new InvalidProfileError(
        `Button '${button.id}' starts in state '${button.initialStateId}', which it does not define`,
      );
    }
  }
}
