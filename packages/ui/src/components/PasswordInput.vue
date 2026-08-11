<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * A password a button types, which the profile never holds.
 *
 * What is stored on the button is a reference — `secret:9f8b…` — and the
 * password itself lives in the machine's sealed store, outside every profile.
 * So this control is not an editor for a value it can see: it can set one,
 * replace one, and remove one, and it is told only whether one is there.
 *
 * That asymmetry is the feature. A profile is copied between machines,
 * exported as an archive and pasted into issues, and a password that travelled
 * with it would be a password nobody meant to send.
 */

const props = defineProps<{
  /** The reference the button holds, if it holds one. */
  modelValue?: string;
  /** Whether that reference has a password behind it. */
  filled: boolean;
}>();

const emit = defineEmits<{
  /** A new reference to store on the button. */
  'update:modelValue': [reference: string];
  save: [value: string, reference: string | undefined];
  clear: [reference: string];
}>();

const { t } = useI18n();

/** Typing a new password; absent means "showing what is already set". */
const draft = ref<string>();
const busy = ref(false);

const editing = computed(() => draft.value !== undefined || !props.filled);

function begin(): void {
  draft.value = '';
}

function cancel(): void {
  draft.value = undefined;
}

async function save(): Promise<void> {
  const value = draft.value ?? '';
  if (value === '' || busy.value) return;

  busy.value = true;
  try {
    emit('save', value, props.modelValue);
  } finally {
    // Cleared from the window the moment it is handed over: there is no reason
    // for it to sit in a field afterwards, and every reason not to.
    draft.value = undefined;
    busy.value = false;
  }
}

function clear(): void {
  if (props.modelValue) emit('clear', props.modelValue);
  draft.value = undefined;
}
</script>

<template>
  <span class="password">
    <template v-if="editing">
      <input
        type="password"
        autocomplete="new-password"
        spellcheck="false"
        :placeholder="t('editor.passwordNew')"
        :value="draft ?? ''"
        @input="draft = ($event.target as HTMLInputElement).value"
        @keydown.enter.prevent="save"
      />
      <button type="button" class="primary" :disabled="!draft" @click="save">
        {{ t('editor.passwordSave') }}
      </button>
      <button v-if="filled" type="button" @click="cancel">{{ t('prompt.cancel') }}</button>
    </template>

    <template v-else>
      <!-- Dots of a fixed length: showing the real one would leak how long the
           password is to anyone glancing at the screen. -->
      <span class="dots">••••••••</span>
      <button type="button" @click="begin">{{ t('editor.passwordChange') }}</button>
      <button type="button" class="danger" @click="clear">{{ t('editor.passwordClear') }}</button>
    </template>

    <span class="muted small note">
      {{ filled ? t('editor.passwordStored') : t('editor.passwordEmpty') }}
    </span>
  </span>
</template>

<style scoped>
.password {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.password input {
  flex: 1 1 12em;
  min-width: 8em;
}

.dots {
  flex: 1 1 12em;
  min-width: 8em;
  letter-spacing: 2px;
  color: var(--text-muted);
}

.note {
  flex-basis: 100%;
}

.danger {
  color: var(--danger);
}
</style>
