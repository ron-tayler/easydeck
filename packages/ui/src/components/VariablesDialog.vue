<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VariableDeclaration, VariableType, VariableValue } from '@easydeck/protocol';

import {
  PROFILE_GROUP,
  groupVariables,
  usePluginTitle,
  type VariableRow,
} from '../composables/useVariableGroups.js';
import NewVariableDialog from './NewVariableDialog.vue';

const props = defineProps<{
  /** Live values, which are what the deck is actually showing. */
  variables: Readonly<Record<string, VariableValue>>;
  /** What each variable is, and who owns it. */
  declarations: readonly VariableDeclaration[];
}>();

const emit = defineEmits<{
  /** Add or edit a declaration the profile owns. */
  declare: [declaration: VariableDeclaration];
  set: [payload: { name: string; value: VariableValue }];
  remove: [name: string];
  close: [];
}>();

const { t } = useI18n();
const pluginTitle = usePluginTitle();

/**
 * Everything the deck knows about, sorted into who it belongs to.
 *
 * A variable can exist without a declaration — an action is free to write a
 * name nobody declared — and hiding those would make the window lie about what
 * the deck is holding. They sit with the profile's own, because that is who
 * made them, and their author column says plainly that nobody declared them.
 */
const groups = computed(() =>
  groupVariables({
    values: props.variables,
    declarations: props.declarations,
    profileTitle: t('variables.profileGroup'),
    pluginTitle,
  }),
);

const taken = computed(() => groups.value.flatMap((group) => group.rows.map((row) => row.name)));

/** Who to credit: a plugin by name, the profile, or nobody at all. */
function author(row: VariableRow): string {
  if (row.pluginId) return pluginTitle(row.pluginId);
  return row.declared ? t('variables.profileGroup') : t('variables.undeclared');
}

// --- editing a value ------------------------------------------------------

const drafts = ref<Record<string, string>>({});

function commitText(name: string, type: VariableType): void {
  const draft = drafts.value[name];
  if (draft === undefined) return;

  delete drafts.value[name];
  const value = type === 'number' ? Number(draft) : draft;
  if (type === 'number' && !Number.isFinite(value as number)) return;
  if (String(value) !== String(props.variables[name] ?? '')) emit('set', { name, value });
}

// --- adding a variable ----------------------------------------------------

const adding = ref(false);

function create(declaration: VariableDeclaration): void {
  emit('declare', declaration);
  adding.value = false;
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2>{{ t('variables.title') }}</h2>
        <button type="button" class="close" :aria-label="t('settings.close')" @click="emit('close')">
          ✕
        </button>
      </header>

      <p class="muted hint">{{ t('variables.hint') }}</p>

      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>{{ t('variables.name') }}</th>
              <th>{{ t('variables.type') }}</th>
              <th>{{ t('variables.author') }}</th>
              <th>{{ t('variables.value') }}</th>
              <th></th>
            </tr>
          </thead>

          <tbody v-for="group in groups" :key="group.id">
            <!-- One heading per owner, and the button that adds to the only
                 group anybody can add to sits in its own heading rather than
                 at the bottom of a window it has nothing to do with. -->
            <tr class="group">
              <th colspan="4">{{ group.title }}</th>
              <th class="add-cell">
                <button
                  v-if="group.id === PROFILE_GROUP"
                  type="button"
                  class="add"
                  :title="t('variables.add')"
                  @click="adding = true"
                >
                  +
                </button>
              </th>
            </tr>

            <tr v-if="group.rows.length === 0">
              <td colspan="5" class="muted empty">{{ t('variables.none') }}</td>
            </tr>

            <tr v-for="row in group.rows" :key="row.name">
              <td class="name">
                <code>{{ row.name }}<template v-if="row.family">(…)</template></code>
              </td>

              <td class="type muted">{{ t(`variables.types.${row.type}`) }}</td>

              <td class="author muted">{{ author(row) }}</td>

              <td>
                <!-- A family is a declaration, not a variable: `obs.mute` is
                     the shape of a name and the values live in the keys under
                     it. A control here would set something nothing reads. -->
                <span v-if="row.family" class="muted family">
                  {{ t('variables.family') }}
                </span>

                <!-- The control follows the declared type: a boolean deserves
                     a checkbox, and an enum should not be free text. -->
                <input
                  v-else-if="row.type === 'boolean'"
                  type="checkbox"
                  :checked="row.value !== '' && row.value !== 'false'"
                  @change="
                    emit('set', {
                      name: row.name,
                      value: ($event.target as HTMLInputElement).checked,
                    })
                  "
                />

                <select
                  v-else-if="row.type === 'enum'"
                  :value="row.value"
                  @change="
                    emit('set', { name: row.name, value: ($event.target as HTMLSelectElement).value })
                  "
                >
                  <option
                    v-for="option in row.declaration?.options ?? []"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.value }}
                  </option>
                </select>

                <input
                  v-else
                  :type="row.type === 'number' ? 'number' : 'text'"
                  :value="drafts[row.name] ?? row.value"
                  @input="drafts[row.name] = ($event.target as HTMLInputElement).value"
                  @blur="commitText(row.name, row.type)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </td>

              <td class="actions">
                <!-- A plugin's variable has no delete button: the plugin keeps
                     writing to it, so it would simply reappear. -->
                <button
                  v-if="!row.pluginId"
                  type="button"
                  class="remove"
                  :title="t('variables.remove')"
                  @click="emit('remove', row.name)"
                >
                  ✕
                </button>
                <span v-else class="locked" :title="t('variables.ownedHint')">🔒</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <NewVariableDialog
      v-if="adding"
      :taken="taken"
      @create="create"
      @close="adding = false"
    />
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  z-index: 25;
}

.dialog {
  display: flex;
  flex-direction: column;
  width: min(680px, 92vw);
  max-height: min(560px, 88vh);
  padding: 16px 18px 18px;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 48px var(--shadow);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h2 { margin: 0; font-size: 15px; }

.close {
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 4px 6px;
}

.hint { font-size: 12px; margin: 6px 0 12px; line-height: 1.4; }

.scroll { overflow-y: auto; flex: 1; min-height: 0; }

table { width: 100%; border-collapse: collapse; }

thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0 6px 5px 0;
  background: var(--surface-0);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: normal;
  text-align: left;
}

td {
  padding: 4px 6px 4px 0;
  vertical-align: middle;
}

.group th {
  padding: 10px 6px 4px 0;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  text-align: left;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

.add-cell { text-align: right; }

.add {
  padding: 0 7px;
  background: none;
  color: var(--accent);
  font-size: 14px;
  line-height: 18px;
}

.name { width: 32%; }
.type { width: 13%; font-size: 11px; }
.author { width: 18%; font-size: 11px; }
.actions { width: 28px; text-align: right; }

code { font-family: ui-monospace, monospace; font-size: 12px; }

.locked { font-size: 11px; opacity: 0.5; }

input[type='text'],
input[type='number'],
select { width: 100%; }

input[type='checkbox'] { width: 16px; height: 16px; }

.remove {
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 3px 6px;
}

.remove:hover { color: var(--danger); }

.empty { font-size: 12px; padding: 6px 0; }
</style>
