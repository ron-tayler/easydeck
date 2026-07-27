import { BUTTON_EVENTS } from './action.js';
import { InvalidProfileError } from './errors.js';
import type { ProfileDefinition } from './profile.js';

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
  const keyCount = rows * cols;

  if (!Array.isArray(profile.pages) || profile.pages.length === 0) {
    throw new InvalidProfileError(`Profile '${profile.id}' has no pages`);
  }

  const pageIds = new Set<string>();
  for (const page of profile.pages) {
    if (!page.id) throw new InvalidProfileError('Every page needs an id');
    if (pageIds.has(page.id)) {
      throw new InvalidProfileError(`Duplicate page id '${page.id}'`);
    }
    pageIds.add(page.id);

    const buttonIds = new Set<string>();
    const usedKeys = new Set<number>();

    for (const button of page.buttons ?? []) {
      if (!button.id) throw new InvalidProfileError(`Page '${page.id}' has a button without an id`);
      if (buttonIds.has(button.id)) {
        throw new InvalidProfileError(`Duplicate button id '${button.id}' on page '${page.id}'`);
      }
      buttonIds.add(button.id);

      if (!Number.isInteger(button.key) || button.key < 0 || button.key >= keyCount) {
        throw new InvalidProfileError(
          `Button '${button.id}' sits on key ${button.key}, outside a ${rows}x${cols} layout`,
        );
      }
      if (usedKeys.has(button.key)) {
        throw new InvalidProfileError(
          `Key ${button.key} on page '${page.id}' is claimed by more than one button`,
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

  if (profile.initialPageId && !pageIds.has(profile.initialPageId)) {
    throw new InvalidProfileError(
      `Profile '${profile.id}' starts on page '${profile.initialPageId}', which does not exist`,
    );
  }
}
