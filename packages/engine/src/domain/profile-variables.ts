import { CORE_ON } from './action.js';
import type { Condition } from './condition.js';
import type { ButtonDefinition, FolderDefinition, ProfileDefinition } from './profile.js';
import { referencedVariables } from './template.js';

/**
 * Every variable a profile reads, wherever it reads it.
 *
 * Four places, and all of them matter: a label substitutes `{{obs.scene}}`, a
 * button binds its state to a variable by name, a picture binds a parameter to
 * one so its needle moves, and a handler waits for one to become something.
 * Anything else — an action's parameters, which are templates too, and the
 * conditions inside a script that has already started — is a *write* or a
 * one-off read at press time, and does not need watching.
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

          // A picture that answers to a variable reads it just as surely as a
          // label does — the needle moves on every repaint, from the same
          // snapshot. Left out, a gauge bound to a plugin's value would be a
          // gauge that never moves.
          for (const binding of Object.values(state.visual.icon?.params ?? {})) {
            if (typeof binding === 'object' && binding.variable) names.add(binding.variable);
          }
        }

        for (const when of handlerConditions(button)) fromCondition(when, names);
      }
    }

    for (const child of folder.folders ?? []) walk(child);
  };

  walk(profile.root);
  return [...names];
}

/**
 * What every "when this happens" on a button is waiting for.
 *
 * Without these a handler could wait forever. A plugin only reports on what it
 * is told something reads, and a profile whose only interest in `obs.recording`
 * is a handler used to say it read nothing at all — so the value never
 * arrived, and the handler that existed precisely to notice it never fired.
 *
 * Every state is looked at rather than the one on screen: which state a button
 * is showing depends on the variables, and deciding what to watch from that
 * would be circular.
 */
function handlerConditions(button: ButtonDefinition): Condition[] {
  const found: Condition[] = [];

  for (const state of button.states) {
    for (const step of state.actions?.event ?? []) {
      if (step.type !== CORE_ON) continue;
      const when = step.params?.['when'] as Condition | undefined;
      if (when) found.push(when);
    }
  }

  return found;
}

/** A condition reads a variable by name, or renders a template full of them. */
function fromCondition(when: Condition, into: Set<string>): void {
  if (when.source === 'variable' && when.name) into.add(when.name);
  if (when.source === 'template' && when.text) {
    for (const name of referencedVariables(when.text)) into.add(name);
  }
}
