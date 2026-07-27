import { numberParam, stringParam, valueParam } from '../domain/action.js';
import type { ActionRegistry } from './action-registry.js';

/**
 * Actions that are pure deck logic and need no I/O.
 *
 * Anything that touches the outside world — pressing hotkeys, launching
 * programs, HTTP — lives in the daemon instead, so this zone stays testable
 * without mocking an operating system.
 */
export function registerBuiltinActions(registry: ActionRegistry): ActionRegistry {
  registry.register('set-variable', (params, ctx) => {
    ctx.variables.set(stringParam(params, 'name'), valueParam(params, 'value'));
  });

  registry.register('toggle-variable', (params, ctx) => {
    ctx.variables.toggle(stringParam(params, 'name'));
  });

  registry.register('increment-variable', (params, ctx) => {
    ctx.variables.increment(stringParam(params, 'name'), numberParam(params, 'by', 1));
  });

  registry.register('cycle-variable', (params, ctx) => {
    const name = stringParam(params, 'name');
    const values = params['values'];
    if (!Array.isArray(values) || values.length === 0) {
      throw new TypeError("Parameter 'values' must be a non-empty array");
    }
    const current = ctx.variables.get(name);
    const index = values.findIndex((candidate) => candidate === current);
    ctx.variables.set(name, values[(index + 1) % values.length]);
  });

  registry.register('go-to-page', (params, ctx) => {
    ctx.goToPage(stringParam(params, 'pageId'));
  });

  registry.register('set-button-state', (params, ctx) => {
    // Defaulting to the pressed button makes the common self-toggle case a
    // one-parameter action.
    const buttonId = typeof params['buttonId'] === 'string' ? params['buttonId'] : ctx.button.id;
    ctx.setButtonState(buttonId, stringParam(params, 'stateId'));
  });

  return registry;
}
