import type { ActionContext, ActionDescriptor, ActionHandler } from '../domain/action.js';
import { ActionFailedError, UnknownActionError } from '../domain/errors.js';

/**
 * Maps action types to the code that runs them.
 *
 * This is the seam plugins will eventually plug into: the engine only knows
 * type names, so a plugin adding `obs.switch-scene` needs no change here.
 */
export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>();

  register(type: string, handler: ActionHandler): this {
    if (this.handlers.has(type)) {
      throw new Error(`Action type '${type}' is already registered`);
    }
    this.handlers.set(type, handler);
    return this;
  }

  /** Replaces an existing handler, or adds it. Used when reloading plugins. */
  replace(type: string, handler: ActionHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  unregister(type: string): boolean {
    return this.handlers.delete(type);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  types(): string[] {
    return [...this.handlers.keys()];
  }

  async run(action: ActionDescriptor, context: ActionContext): Promise<void> {
    const handler = this.handlers.get(action.type);
    if (!handler) throw new UnknownActionError(action.type);

    try {
      await handler(action.params ?? {}, context);
    } catch (cause) {
      throw new ActionFailedError(action.type, context.button.id, { cause });
    }
  }
}
