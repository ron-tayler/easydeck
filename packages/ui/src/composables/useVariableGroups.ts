import { inject, provide } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import { parseVariableKey } from '@easydeck/engine/variables';
import type { LocalizedText, VariableDeclaration, VariableType, VariableValue } from '@easydeck/protocol';

/**
 * Variables sorted into who they belong to.
 *
 * One flat alphabetical list was fine while a profile held six names the user
 * had typed themselves. A handful of plugins turns it into a hundred, and then
 * the list stops being something to read and becomes something to search — at
 * which point the only structure in it, the `obs.` prefix on the front of every
 * name, is doing work that belongs to the window.
 *
 * Kept out of the components because the same grouping has to appear in three
 * different shapes — a cascading menu, an insert-a-template popover, and the
 * table in the variables window — and three copies of "which plugin owns this
 * name" is three chances to answer it differently.
 */

export const PROFILE_GROUP = 'profile';

export interface VariableRow {
  /** The key as it is written, argument and all: `obs.mute(Микрофон)`. */
  readonly name: string;
  readonly label?: LocalizedText;
  readonly type: VariableType;
  /** The live value, as text; empty for a family that stands for many keys. */
  readonly value: string;
  readonly pluginId?: string;
  readonly declaration?: VariableDeclaration;
  /**
   * False for a name that exists only because something wrote to it.
   *
   * Not hidden: an action may write any name it likes, and a window that
   * showed only declared ones would be lying about what the deck is holding.
   */
  readonly declared: boolean;
  /** A declaration that stands for many keys rather than being one itself. */
  readonly family: boolean;
}

export interface VariableGroup {
  /** `PROFILE_GROUP`, or the plugin's id. */
  readonly id: string;
  readonly title: string;
  readonly rows: readonly VariableRow[];
}

export interface GroupingOptions {
  readonly values: Readonly<Record<string, VariableValue>>;
  readonly declarations: readonly VariableDeclaration[];
  /** What to call the group of variables the profile owns. */
  readonly profileTitle: string;
  /** A plugin's name for a heading; its id is the fallback. */
  readonly pluginTitle: (pluginId: string) => string;
  /**
   * `declared` lists families rather than keys.
   *
   * Binding a state to `obs.mute` asks which microphone as a second question,
   * so offering `obs.mute(Микрофон)` and `obs.mute(Гарнитура)` as separate
   * answers there would be offering the same answer twice.
   */
  readonly mode?: 'all' | 'declared';
}

export function groupVariables(options: GroupingOptions): VariableGroup[] {
  const { values, declarations, mode = 'all' } = options;

  const byName = new Map<string, VariableDeclaration>();
  for (const declaration of declarations) byName.set(declaration.name, declaration);

  const names =
    mode === 'declared'
      ? [...byName.keys()]
      : [...new Set([...byName.keys(), ...Object.keys(values)])];

  const rows: VariableRow[] = [];
  for (const name of names) {
    /*
     * A key belongs to whoever declared its family.
     *
     * `obs.mute(Микрофон)` has no declaration of its own — the plugin declares
     * `obs.mute` once and the argument rides in the key — so looking the whole
     * string up finds nothing, and every one of a plugin's live keys used to
     * be filed under the user's own variables.
     */
    const declaration = byName.get(name) ?? byName.get(parseVariableKey(name).family);
    const value = values[name];

    rows.push({
      name,
      ...(declaration?.label ? { label: declaration.label } : {}),
      type: declaration?.type ?? 'string',
      value: value === undefined ? '' : String(value),
      ...(declaration?.pluginId ? { pluginId: declaration.pluginId } : {}),
      ...(declaration ? { declaration } : {}),
      declared: declaration !== undefined,
      family: declaration?.argument !== undefined && declaration.name === name,
    });
  }

  const groups = new Map<string, VariableRow[]>([[PROFILE_GROUP, []]]);
  for (const row of rows) {
    const id = row.pluginId ?? PROFILE_GROUP;
    const kept = groups.get(id);
    if (kept) kept.push(row);
    else groups.set(id, [row]);
  }

  const ordered: VariableGroup[] = [];
  for (const [id, list] of groups) {
    ordered.push({
      id,
      title: id === PROFILE_GROUP ? options.profileTitle : options.pluginTitle(id),
      rows: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  // The profile's own first, whether or not it has anything in it: it is the
  // group somebody can add to, and a heading that moves about is a heading
  // nobody learns the position of.
  return ordered.sort((a, b) => {
    if ((a.id === PROFILE_GROUP) !== (b.id === PROFILE_GROUP)) return a.id === PROFILE_GROUP ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/** Every row of every group, for searching across all of them at once. */
export function allRows(groups: readonly VariableGroup[]): VariableRow[] {
  return groups.flatMap((group) => group.rows);
}

/**
 * Plugin names, handed down rather than threaded through.
 *
 * Five components away from the window that knows the plugins need a heading
 * for a group, and none of them have any other business with plugins. Passing
 * the list down five levels of props to be read at the bottom is the shape
 * this exists to avoid.
 */
export const PLUGIN_TITLES = Symbol('easydeck.pluginTitles') as InjectionKey<
  Ref<Readonly<Record<string, string>>>
>;

export function providePluginTitles(titles: Ref<Readonly<Record<string, string>>>): void {
  provide(PLUGIN_TITLES, titles);
}

/** The name of a plugin, falling back to its id where nobody provided one. */
export function usePluginTitle(): (pluginId: string) => string {
  const titles = inject(PLUGIN_TITLES, undefined);
  return (pluginId: string) => titles?.value[pluginId] ?? pluginId;
}
