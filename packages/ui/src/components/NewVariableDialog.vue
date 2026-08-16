<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VariableDeclaration, VariableType, VariableValue } from '@easydeck/protocol';

import { VARIABLE_NAME } from '../composables/useProfileEditor.js';

/**
 * Making a variable, asked for in one place instead of three fields in a row.
 *
 * The form used to live along the bottom of the variables window, where it
 * competed with the list for the same attention and could only be as tall as
 * the row it sat in — which is why the starting value, the one thing a new
 * variable most obviously needs, had nowhere to go and was left out.
 */

const props = defineProps<{
  /** Every name already in use, declared or merely written to. */
  taken: readonly string[];
}>();

const emit = defineEmits<{ create: [declaration: VariableDeclaration]; close: [] }>();

const { t } = useI18n();

const TYPES: readonly VariableType[] = ['string', 'number', 'boolean', 'enum'];

const name = ref('');
const type = ref<VariableType>('string');
const options = ref('');
const initial = ref('');
const flag = ref(false);

const trimmed = computed(() => name.value.trim());
const nameValid = computed(() => VARIABLE_NAME.test(trimmed.value));
const nameTaken = computed(() => props.taken.includes(trimmed.value));

/** An enum with nothing to pick from is a variable nobody could ever set. */
const optionList = computed(() =>
  options.value
    .split(',')
    .map((option) => option.trim())
    .filter((option) => option.length > 0),
);

const canAdd = computed(
  () => nameValid.value && !nameTaken.value && (type.value !== 'enum' || optionList.value.length > 0),
);

/** What the variable starts at, in the shape its own type calls for. */
const startsAt = computed<VariableValue | undefined>(() => {
  switch (type.value) {
    case 'boolean':
      return flag.value;
    case 'number': {
      const parsed = Number(initial.value);
      return initial.value.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
    }
    case 'enum':
      // Whichever was named first, which is the one a fresh key will show.
      return optionList.value.includes(initial.value) ? initial.value : optionList.value[0];
    default:
      return initial.value === '' ? undefined : initial.value;
  }
});

function submit(): void {
  if (!canAdd.value) return;

  const start = startsAt.value;
  emit('create', {
    name: trimmed.value,
    type: type.value,
    ...(type.value === 'enum' ? { options: optionList.value.map((value) => ({ value })) } : {}),
    ...(start === undefined ? {} : { initial: start }),
  });
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <form class="dialog" role="dialog" aria-modal="true" @submit.prevent="submit">
      <header>
        <h2>{{ t('variables.newTitle') }}</h2>
        <button type="button" class="close" :aria-label="t('settings.close')" @click="emit('close')">
          ✕
        </button>
      </header>

      <label class="field">
        <span>{{ t('variables.name') }}</span>
        <input v-model="name" type="text" autofocus />
      </label>

      <label class="field">
        <span>{{ t('variables.type') }}</span>
        <select v-model="type">
          <option v-for="each in TYPES" :key="each" :value="each">
            {{ t(`variables.types.${each}`) }}
          </option>
        </select>
      </label>

      <label v-if="type === 'enum'" class="field">
        <span>{{ t('variables.options') }}</span>
        <input v-model="options" type="text" :placeholder="t('variables.optionsHint')" />
      </label>

      <!-- The starting value follows the type, exactly as the list does: a
           yes/no deserves a checkbox and a list should not be free text. -->
      <label class="field">
        <span>{{ t('variables.initial') }}</span>

        <input v-if="type === 'boolean'" v-model="flag" type="checkbox" class="flag" />

        <select v-else-if="type === 'enum'" v-model="initial" :disabled="optionList.length === 0">
          <option v-for="option in optionList" :key="option" :value="option">{{ option }}</option>
        </select>

        <input v-else v-model="initial" :type="type === 'number' ? 'number' : 'text'" />
      </label>

      <p v-if="trimmed.length > 0 && !nameValid" class="warn">{{ t('variables.badName') }}</p>
      <p v-else-if="nameTaken" class="warn">{{ t('variables.exists') }}</p>

      <footer>
        <button type="button" @click="emit('close')">{{ t('prompt.cancel') }}</button>
        <button type="submit" class="primary" :disabled="!canAdd">{{ t('variables.add') }}</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 45%);
  display: grid;
  place-items: center;
  z-index: 30;
}

.dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(360px, 92vw);
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

.field {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.field input:not(.flag),
.field select { width: 100%; }

.flag { width: 16px; height: 16px; }

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.warn { margin: 0; font-size: 12px; color: var(--danger); }
</style>
