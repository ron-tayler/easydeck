<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps<{ title: string; message: string }>();

const emit = defineEmits<{ confirm: [dontAskAgain: boolean]; cancel: [] }>();

const { t } = useI18n();

const dontAskAgain = ref(false);
</script>

<template>
  <!-- Escape and a click outside both cancel: the safe answer must be the one
       that costs nothing to reach. -->
  <div class="backdrop" @click.self="emit('cancel')" @keydown.esc="emit('cancel')">
    <div class="dialog" role="alertdialog" aria-modal="true">
      <h2>{{ title }}</h2>
      <p class="message">{{ message }}</p>

      <label class="again">
        <input v-model="dontAskAgain" type="checkbox" />
        <span>{{ t('confirm.dontAsk') }}</span>
      </label>

      <footer>
        <button type="button" @click="emit('cancel')">{{ t('prompt.cancel') }}</button>
        <!-- Focused rather than the cancel button: the dialog is opened by a
             deliberate delete, so Enter should finish what was started. -->
        <button type="button" class="danger" autofocus @click="emit('confirm', dontAskAgain)">
          {{ t('confirm.delete') }}
        </button>
      </footer>
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
  z-index: 40;
}

.dialog {
  width: min(400px, 92vw);
  padding: 16px 18px 14px;
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 48px var(--shadow);
}

h2 { margin: 0 0 8px; font-size: 15px; }

.message {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-muted);
}

.again {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}

.again input { width: 15px; height: 15px; }

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.danger { border-color: var(--danger); color: var(--danger); }
</style>
