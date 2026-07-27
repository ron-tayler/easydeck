<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VariableDeclaration, VariableType, VariableValue } from '@easydeck/core';

import { VARIABLE_NAME } from '../composables/useProfileEditor.js';

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

const TYPES: readonly VariableType[] = ['string', 'number', 'boolean', 'enum'];

const byName = computed(() => {
  const map = new Map<string, VariableDeclaration>();
  for (const declaration of props.declarations) map.set(declaration.name, declaration);
  return map;
});

/**
 * Everything the deck knows about, declared or not.
 *
 * A variable can exist without a declaration — an action is free to write a
 * name nobody declared — and hiding those would make the dialog lie about what
 * the deck is holding.
 */
const rows = computed(() => {
  const names = new Set([...Object.keys(props.variables), ...byName.value.keys()]);

  return [...names]
    .map((name) => {
      const declaration = byName.value.get(name);
      return {
        name,
        declaration,
        type: declaration?.type ?? 'string',
        pluginId: declaration?.pluginId,
        value: props.variables[name] ?? '',
      };
    })
    .sort((a, b) => {
      // The user's own first: plugin variables are reference material, and
      // there may be many of them once plugins arrive.
      if (Boolean(a.pluginId) !== Boolean(b.pluginId)) return a.pluginId ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
});

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

const draft = ref<{ name: string; type: VariableType; options: string }>({
  name: '',
  type: 'string',
  options: '',
});

const trimmed = computed(() => draft.value.name.trim());
const nameTaken = computed(() => byName.value.has(trimmed.value) || trimmed.value in props.variables);
const nameValid = computed(() => VARIABLE_NAME.test(trimmed.value));
/** An enum with nothing to pick from is a variable nobody could ever set. */
const optionList = computed(() =>
  draft.value.options
    .split(',')
    .map((option) => option.trim())
    .filter((option) => option.length > 0),
);
const canAdd = computed(
  () =>
    nameValid.value &&
    !nameTaken.value &&
    (draft.value.type !== 'enum' || optionList.value.length > 0),
);

function add(): void {
  if (!canAdd.value) return;

  emit('declare', {
    name: trimmed.value,
    type: draft.value.type,
    ...(draft.value.type === 'enum'
      ? { options: optionList.value.map((value) => ({ value })), initial: optionList.value[0] }
      : {}),
  });

  draft.value = { name: '', type: 'string', options: '' };
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
        <table v-if="rows.length > 0">
          <tbody>
            <tr v-for="row in rows" :key="row.name">
              <td class="name">
                <code>{{ row.name }}</code>
                <span v-if="row.pluginId" class="owner" :title="t('variables.ownedHint')">
                  {{ row.pluginId }}
                </span>
              </td>

              <td class="type muted">{{ t(`variables.types.${row.type}`) }}</td>

              <td>
                <!-- The control follows the declared type: a boolean deserves
                     a checkbox, and an enum should not be free text. -->
                <input
                  v-if="row.type === 'boolean'"
                  type="checkbox"
                  :checked="row.value !== false && row.value !== '' && row.value !== 'false'"
                  @change="
                    emit('set', {
                      name: row.name,
                      value: ($event.target as HTMLInputElement).checked,
                    })
                  "
                />

                <select
                  v-else-if="row.type === 'enum'"
                  :value="String(row.value)"
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
                  :value="drafts[row.name] ?? String(row.value)"
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

        <p v-else class="muted empty">{{ t('variables.none') }}</p>
      </div>

      <form class="add" @submit.prevent="add">
        <input v-model="draft.name" type="text" :placeholder="t('variables.name')" />
        <select v-model="draft.type">
          <option v-for="type in TYPES" :key="type" :value="type">
            {{ t(`variables.types.${type}`) }}
          </option>
        </select>
        <button type="submit" :disabled="!canAdd">{{ t('variables.add') }}</button>

        <input
          v-if="draft.type === 'enum'"
          v-model="draft.options"
          class="options"
          type="text"
          :placeholder="t('variables.optionsHint')"
        />
      </form>

      <p v-if="trimmed.length > 0 && !nameValid" class="warn">{{ t('variables.badName') }}</p>
      <p v-else-if="nameTaken" class="warn">{{ t('variables.exists') }}</p>
    </div>
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
  width: min(620px, 92vw);
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

td {
  padding: 4px 6px 4px 0;
  vertical-align: middle;
}

.name { width: 34%; }
.type { width: 15%; font-size: 11px; }
.actions { width: 28px; text-align: right; }

code { font-family: ui-monospace, monospace; font-size: 12px; }

.owner {
  display: inline-block;
  margin-left: 5px;
  padding: 0 5px;
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 10px;
}

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

.add {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content max-content;
  gap: 8px;
  padding-top: 12px;
  margin-top: 10px;
  border-top: 1px solid var(--border);
}

.options { grid-column: 1 / -1; }

.warn { margin: 8px 0 0; font-size: 12px; color: var(--danger); }
.empty { font-size: 13px; margin: 8px 0; }
</style>
