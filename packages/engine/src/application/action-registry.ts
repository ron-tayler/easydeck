import type { ActionContext, ActionDescriptor, ActionHandler } from '../domain/action.js';
import { ActionFailedError, EngineError, UnknownActionError } from '../domain/errors.js';
import { PLUGIN_API_VERSION } from '../domain/plugin.js';
import type { ActionDefinition, ParamDefinition, PluginManifest } from '../domain/plugin.js';
import { hasPlaceholders, renderTemplate } from '../domain/template.js';
import type {
  VariableDeclaration,
  VariableStore,
  VariableValue,
} from '../domain/variables.js';

/**
 * Installed plugins and the code behind their actions.
 *
 * The engine only ever knows action types, so a plugin adding
 * `obs.switch-scene` needs no change here. What the registry adds on top of a
 * plain map is the manifest: the configurator builds its whole action picker
 * and every parameter form from these declarations, which is why a plugin
 * ships data describing its parameters rather than a UI control.
 */
export class ActionRegistry {
  private readonly handlers = new Map<string, ActionHandler>();
  private readonly definitions = new Map<string, ActionDefinition>();
  private readonly manifests = new Map<string, PluginManifest>();

  /**
   * Installs a plugin: its manifest and the handler for each declared action.
   *
   * Declarations and code are checked against each other here, so a manifest
   * that drifts from its implementation fails at startup rather than when a
   * user presses the one button that used it.
   */
  installPlugin(manifest: PluginManifest, handlers: Readonly<Record<string, ActionHandler>>): this {
    if (manifest.apiVersion > PLUGIN_API_VERSION) {
      throw new EngineError(
        `Plugin '${manifest.id}' targets plugin API ${manifest.apiVersion}, but this build supports ${PLUGIN_API_VERSION}`,
      );
    }
    if (this.manifests.has(manifest.id)) {
      throw new EngineError(`Plugin '${manifest.id}' is already installed`);
    }

    const declared = new Set(manifest.actions.map((action) => action.type));
    for (const type of Object.keys(handlers)) {
      if (!declared.has(type)) {
        throw new EngineError(`Plugin '${manifest.id}' handles '${type}' without declaring it`);
      }
    }

    for (const action of manifest.actions) {
      const handler = handlers[action.type];
      if (!handler) {
        throw new EngineError(`Plugin '${manifest.id}' declares '${action.type}' without a handler`);
      }
      if (!action.type.startsWith(`${manifest.id}.`)) {
        throw new EngineError(
          `Action '${action.type}' does not belong to plugin '${manifest.id}'; namespace it as '${manifest.id}.…'`,
        );
      }

      this.register(action.type, handler);
      this.definitions.set(action.type, action);
    }

    this.manifests.set(manifest.id, manifest);
    return this;
  }

  /**
   * Adds actions to a plugin that is already installed.
   *
   * A plugin is a namespace and a manifest, not one module: the EasyDeck
   * plugin's navigation lives in the engine, while the parts of it that need
   * a filesystem are contributed by the host. Both belong to the same plugin
   * as far as a profile or the configurator is concerned.
   */
  extendPlugin(
    pluginId: string,
    actions: readonly ActionDefinition[],
    handlers: Readonly<Record<string, ActionHandler>>,
  ): this {
    const manifest = this.manifests.get(pluginId);
    if (!manifest) throw new EngineError(`Cannot extend '${pluginId}': it is not installed`);

    for (const action of actions) {
      const handler = handlers[action.type];
      if (!handler) throw new EngineError(`No handler for '${action.type}'`);
      if (!action.type.startsWith(`${pluginId}.`)) {
        throw new EngineError(`Action '${action.type}' does not belong to plugin '${pluginId}'`);
      }

      this.register(action.type, handler);
      this.definitions.set(action.type, action);
    }

    this.manifests.set(pluginId, { ...manifest, actions: [...manifest.actions, ...actions] });
    return this;
  }

  register(type: string, handler: ActionHandler): this {
    if (this.handlers.has(type)) {
      throw new EngineError(`Action type '${type}' is already registered`);
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
    this.definitions.delete(type);
    return this.handlers.delete(type);
  }

  has(type: string): boolean {
    return this.handlers.has(type);
  }

  types(): string[] {
    return [...this.handlers.keys()];
  }

  plugins(): PluginManifest[] {
    return [...this.manifests.values()];
  }

  /**
   * Every variable the installed plugins declare, stamped with its owner.
   *
   * Stamped here rather than in each manifest so a plugin cannot claim to own
   * someone else's variable, and so the configurator can tell at a glance
   * which variables it must not offer to delete.
   */
  variables(): VariableDeclaration[] {
    const declared: VariableDeclaration[] = [];
    for (const manifest of this.manifests.values()) {
      for (const variable of manifest.variables ?? []) {
        declared.push({ ...variable, pluginId: manifest.id });
      }
    }
    return declared;
  }

  definition(type: string): ActionDefinition | undefined {
    return this.definitions.get(type);
  }

  async run(action: ActionDescriptor, context: ActionContext): Promise<void> {
    const handler = this.handlers.get(action.type);
    if (!handler) throw new UnknownActionError(action.type);

    const params = resolveParams(action.params ?? {}, context.variables, context.locals);
    const definition = this.definitions.get(action.type);
    if (definition) assertParams(definition, params);

    try {
      await handler(params, context);
    } catch (cause) {
      throw new ActionFailedError(action.type, context.button.id, { cause });
    }
  }
}

/**
 * Substitutes `{{variable}}` into every text parameter, for every action.
 *
 * Done here rather than in the handlers that happen to want it: a label
 * already reads `{{viewers}}`, so a profile where the same placeholder is
 * inert in "type text" or in a URL is simply confusing. One rule — text is a
 * template, wherever it appears — is easier to hold in your head than a list
 * of which parameters are special, and any plugin written later gets it for
 * free without knowing variables exist.
 *
 * Validation runs on the result, so a required parameter filled only by an
 * unset variable fails the same way an empty one does.
 *
 * The cost of this is that literal `{{` in typed text is not typeable. That
 * trade was already made for labels; making it twice, differently, would be
 * worse than making it once.
 */
function resolveParams(
  params: Readonly<Record<string, unknown>>,
  variables: VariableStore,
  locals?: Readonly<Record<string, VariableValue>>,
): Readonly<Record<string, unknown>> {
  let resolved: Record<string, unknown> | undefined;
  let values: Record<string, VariableValue> | undefined;

  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string' || !hasPlaceholders(value)) continue;

    resolved ??= { ...params };
    // Locals over variables: `{{loop}}` inside a loop is the loop's, and a
    // variable of that name — which nothing should be called — does not win.
    values ??= { ...variables.snapshot(), ...(locals ?? {}) };
    resolved[name] = renderTemplate(value, values);
  }

  return resolved ?? params;
}

/**
 * Checks a descriptor against what its action declared.
 *
 * Done once here rather than in every handler: the message can name the
 * action and the parameter, which is what someone editing a profile by hand
 * actually needs to hear.
 */
function assertParams(
  definition: ActionDefinition,
  params: Readonly<Record<string, unknown>>,
): void {
  for (const param of definition.params ?? []) {
    const value = params[param.name];

    if (value === undefined || value === '') {
      if (param.required === false || param.default !== undefined) continue;
      throw new EngineError(`Action '${definition.type}' needs the parameter '${param.name}'`);
    }

    const problem = checkType(param, value);
    if (problem) throw new EngineError(`Action '${definition.type}': ${problem}`);
  }
}

function checkType(param: ParamDefinition, value: unknown): string | undefined {
  switch (param.type) {
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) return `'${param.name}' must be a number`;
      if (param.min !== undefined && numeric < param.min) {
        return `'${param.name}' must be at least ${param.min}`;
      }
      if (param.max !== undefined && numeric > param.max) {
        return `'${param.name}' must be at most ${param.max}`;
      }
      return undefined;
    }

    case 'boolean':
      return typeof value === 'boolean' ? undefined : `'${param.name}' must be true or false`;

    case 'select': {
      /*
       * A list that only the plugin knows is not one this can check against.
       *
       * `optionsFrom` names a source the host asks the plugin for while a
       * configurator is open — the scenes OBS has right now. Checking such a
       * parameter against the manifest's own (empty) `options` refused every
       * value there is, which made a perfectly good scene button fail on the
       * first press.
       */
      if (param.optionsFrom !== undefined) return undefined;

      const allowed = (param.options ?? []).map((option) => option.value);
      return allowed.includes(String(value))
        ? undefined
        : `'${param.name}' must be one of: ${allowed.join(', ')}`;
    }

    default:
      // The remaining types are all strings as far as the engine is concerned;
      // what makes them different is the control the configurator draws.
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? undefined
        : `'${param.name}' must be a text value`;
  }
}
