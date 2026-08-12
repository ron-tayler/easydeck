import { BUTTON_SCRIPTS } from './action.js';
import { InvalidProfileError } from './errors.js';
import { MAX_PAGES_PER_FOLDER, isStateRange } from './profile.js';
import type { FolderDefinition, ProfileDefinition } from './profile.js';
import { VARIABLE_TYPES } from './variables.js';

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
  validateFolder(profile.root, rows * cols, cols, seen, `${rows}x${cols}`);

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

  validateVariables(profile);
}

function validateVariables(profile: ProfileDefinition): void {
  const names = new Set<string>();

  for (const variable of profile.variables ?? []) {
    if (!variable.name) {
      throw new InvalidProfileError(`Profile '${profile.id}' declares a variable without a name`);
    }
    if (names.has(variable.name)) {
      throw new InvalidProfileError(`Duplicate variable '${variable.name}'`);
    }
    names.add(variable.name);

    if (!VARIABLE_TYPES.includes(variable.type)) {
      throw new InvalidProfileError(
        `Variable '${variable.name}' has unknown type '${variable.type}'`,
      );
    }
    // An enum with nothing to choose from is a variable nobody can set, which
    // is always an authoring mistake rather than an empty-but-valid state.
    if (variable.type === 'enum' && (variable.options ?? []).length === 0) {
      throw new InvalidProfileError(`Enum variable '${variable.name}' has no options`);
    }
  }
}

function validateFolder(
  folder: FolderDefinition,
  keyCount: number,
  cols: number,
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
    validateSpans(page.id, page.buttons ?? [], keyCount, cols, layoutLabel);
  }

  for (const child of folder.folders ?? []) {
    validateFolder(child, keyCount, cols, seen, layoutLabel);
  }
}

/**
 * Merged regions must fit the grid, and must not overlap each other.
 *
 * Overlap is refused rather than resolved by some precedence rule, exactly as
 * a spreadsheet refuses to merge over a merge: whichever rule we picked, half
 * the authors would expect the other one, and the picture that lost would
 * simply vanish with no explanation.
 *
 * Running off the edge is refused for the same reason it is not clamped — a
 * picture silently cut short looks like a rendering bug, and only the author
 * knows whether they meant three columns or four.
 */
function validateSpans(
  pageId: string,
  buttons: readonly ProfileDefinition['root']['pages'][number]['buttons'][number][],
  keyCount: number,
  cols: number,
  layoutLabel: string,
): void {
  const claimed = new Map<number, string>();

  for (const button of buttons) {
    const spanCols = button.colSpan ?? 1;
    const spanRows = button.rowSpan ?? 1;
    if (spanCols === 1 && spanRows === 1) continue;

    if (!Number.isInteger(spanCols) || !Number.isInteger(spanRows) || spanCols < 1 || spanRows < 1) {
      throw new InvalidProfileError(`Button '${button.id}' must span at least one key`);
    }

    const left = button.key % cols;
    const top = Math.floor(button.key / cols);
    if (left + spanCols > cols || (top + spanRows) * cols > keyCount) {
      throw new InvalidProfileError(
        `Button '${button.id}' spans ${spanCols}x${spanRows} from key ${button.key}, ` +
          `which runs past a ${layoutLabel} layout`,
      );
    }

    for (let row = top; row < top + spanRows; row++) {
      for (let col = left; col < left + spanCols; col++) {
        const key = row * cols + col;
        const other = claimed.get(key);
        if (other) {
          throw new InvalidProfileError(
            `Buttons '${other}' and '${button.id}' both span key ${key} on page '${pageId}'`,
          );
        }
        claimed.set(key, button.id);
      }
    }
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

      if (isStateRange(state.when)) {
        const { min, max } = state.when;
        const bounded = (value: unknown) => value === undefined || typeof value === 'number';
        if (!bounded(min) || !bounded(max)) {
          throw new InvalidProfileError(
            `State '${state.id}' on button '${button.id}' has a range with a non-numeric bound`,
          );
        }
        // Caught here rather than left to select nothing at run time: a band
        // that cannot match is always a typo, and one that silently never
        // shows is a button somebody will stare at for an hour.
        if (min !== undefined && max !== undefined && min > max) {
          throw new InvalidProfileError(
            `State '${state.id}' on button '${button.id}' has a range from ${min} to ${max}, which is empty`,
          );
        }
      }

      for (const event of Object.keys(state.actions ?? {})) {
        if (!BUTTON_SCRIPTS.includes(event as never)) {
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
