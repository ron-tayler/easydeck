<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ title: string; value?: string; confirmLabel?: string }>();
const emit = defineEmits<{ confirm: [value: string]; cancel: [] }>();

const { t } = useI18n();
const text = ref(props.value ?? '');
const input = ref<HTMLInputElement>();

/**
 * Exists because Electron disables window.prompt entirely, and because a
 * native prompt could not be themed or translated anyway.
 */
onMounted(async () => {
  await nextTick();
  input.value?.focus();
  input.value?.select();
});

function confirm(): void {
  const trimmed = text.value.trim();
  if (trimmed.length > 0) emit('confirm', trimmed);
}
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')">
    <form class="dialog" @submit.prevent="confirm">
      <h2>{{ title }}</h2>

      <input
        ref="input"
        v-model="text"
        type="text"
        :aria-label="title"
        @keydown.esc.prevent="emit('cancel')"
      />

      <div class="actions">
        <button type="button" @click="emit('cancel')">{{ t('prompt.cancel') }}</button>
        <button type="submit" class="primary" :disabled="text.trim().length === 0">
          {{ confirmLabel ?? t('prompt.confirm') }}
        </button>
      </div>
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
  width: min(380px, 90vw);
  padding: 18px;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 48px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

h2 {
  margin: 0;
  font-size: 14px;
}

input {
  width: 100%;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.primary {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
