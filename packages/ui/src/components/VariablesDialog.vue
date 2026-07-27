<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { VARIABLE_NAME } from '../composables/useProfileEditor.js';

const props = defineProps<{
  /** Live values, which are what the deck is actually showing. */
  variables: Readonly<Record<string, string | number | boolean>>;
}>();

const emit = defineEmits<{
  set: [payload: { name: string; value: string }];
  remove: [name: string];
  close: [];
}>();

const { t } = useI18n();

const newName = ref('');
const newValue = ref('');
const drafts = ref<Record<string, string>>({});

const rows = computed(() =>
  Object.entries(props.variables)
    .map(([name, value]) => ({ name, value: String(value) }))
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const nameTaken = computed(() => newName.value.trim() in props.variables);
const nameValid = computed(() => VARIABLE_NAME.test(newName.value.trim()));
const canAdd = computed(() => nameValid.value && !nameTaken.value);

function add(): void {
  if (!canAdd.value) return;
  emit('set', { name: newName.value.trim(), value: newValue.value });
  newName.value = '';
  newValue.value = '';
}

/** Committed on blur or Enter, so typing does not save on every keystroke. */
function commit(name: string): void {
  const draft = drafts.value[name];
  if (draft === undefined) return;

  delete drafts.value[name];
  if (draft !== String(props.variables[name])) emit('set', { name, value: draft });
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
              <td class="name"><code>{{ row.name }}</code></td>
              <td>
                <input
                  type="text"
                  :value="drafts[row.name] ?? row.value"
                  @input="drafts[row.name] = ($event.target as HTMLInputElement).value"
                  @blur="commit(row.name)"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
              </td>
              <td>
                <button
                  type="button"
                  class="remove"
                  :title="t('variables.remove')"
                  @click="emit('remove', row.name)"
                >
                  ✕
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <p v-else class="muted empty">{{ t('variables.none') }}</p>
      </div>

      <form class="add" @submit.prevent="add">
        <input v-model="newName" type="text" :placeholder="t('variables.name')" />
        <input v-model="newValue" type="text" :placeholder="t('variables.value')" />
        <button type="submit" :disabled="!canAdd">{{ t('variables.add') }}</button>
      </form>

      <p v-if="newName.trim().length > 0 && !nameValid" class="warn">
        {{ t('variables.badName') }}
      </p>
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
  width: min(560px, 92vw);
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

.name { width: 40%; }

code { font-family: ui-monospace, monospace; font-size: 12px; }

input { width: 100%; }

.remove {
  background: none;
  border: none;
  color: var(--text-muted);
  padding: 3px 6px;
}

.remove:hover { color: var(--danger); }

.add {
  display: grid;
  grid-template-columns: 40% minmax(0, 1fr) max-content;
  gap: 8px;
  padding-top: 12px;
  margin-top: 10px;
  border-top: 1px solid var(--border);
}

.warn { margin: 8px 0 0; font-size: 12px; color: var(--danger); }
.empty { font-size: 13px; margin: 8px 0; }
</style>
