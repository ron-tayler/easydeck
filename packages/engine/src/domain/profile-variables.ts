import type { FolderDefinition, ProfileDefinition } from './profile.js';
import { referencedVariables } from './template.js';

/**
 * Every variable a profile reads, wherever it reads it.
 *
 * Two places, and both matter: a label substitutes `{{obs.scene}}`, and a
 * button binds its state to a variable by name. Anything else — an action's
 * parameters, which are templates too — is a *write* or a one-off read at
 * press time, and does not need watching.
 *
 * Exists so a plugin can be told what is worth reporting on. A plugin whose
 * variables take an argument has as many of them as the user has objects in
 * another program, and publishing all of them so that one key can show
 * whether the microphone is muted is the kind of waste that grows with
 * somebody else's scene collection rather than with anything we control.
 */
export function variablesReadBy(profile: ProfileDefinition): string[] {
  const names = new Set<string>();

  const walk = (folder: FolderDefinition): void => {
    for (const page of folder.pages ?? []) {
      for (const button of page.buttons) {
        if (button.stateFrom) names.add(button.stateFrom);

        for (const state of button.states) {
          const text = state.visual.label?.text;
          if (text) for (const name of referencedVariables(text)) names.add(name);
        }
      }
    }

    for (const child of folder.folders ?? []) walk(child);
  };

  walk(profile.root);
  return [...names];
}
