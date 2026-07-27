<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  /** Draws a divider above this item. */
  readonly separated?: boolean;
  /** Shown greyed on the right, e.g. a shortcut or a "not yet" note. */
  readonly note?: string;
}

const props = defineProps<{ x: number; y: number; items: readonly MenuItem[] }>();
const emit = defineEmits<{ choose: [id: string]; close: [] }>();

const menu = ref<HTMLElement>();
const position = ref({ x: props.x, y: props.y });

/**
 * Keeps the menu on screen.
 *
 * Measured after mount rather than guessed from item count, because the
 * translated labels decide the width and they differ per language.
 */
onMounted(() => {
  const element = menu.value;
  if (!element) return;

  const { width, height } = element.getBoundingClientRect();
  position.value = {
    x: Math.min(props.x, window.innerWidth - width - 8),
    y: Math.min(props.y, window.innerHeight - height - 8),
  };

  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
});

function onOutside(event: MouseEvent): void {
  if (!menu.value?.contains(event.target as Node)) emit('close');
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

const style = computed(() => ({ left: `${position.value.x}px`, top: `${position.value.y}px` }));
</script>

<template>
  <div ref="menu" class="menu" :style="style" role="menu">
    <template v-for="item in items" :key="item.id">
      <hr v-if="item.separated" />
      <button
        type="button"
        role="menuitem"
        :class="{ danger: item.danger }"
        :disabled="item.disabled"
        @click="emit('choose', item.id)"
      >
        <span>{{ item.label }}</span>
        <span v-if="item.note" class="note">{{ item.note }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 20;
  min-width: 190px;
  padding: 5px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 12px 32px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  background: none;
  border: none;
  border-radius: 6px;
  padding: 6px 9px;
  font-size: 13px;
  text-align: left;
}

button:hover:not(:disabled) {
  background: var(--surface-2);
}

button.danger:not(:disabled) {
  color: var(--danger);
}

.note {
  font-size: 11px;
  color: var(--text-muted);
}

hr {
  margin: 4px 2px;
  border: none;
  border-top: 1px solid var(--border);
}
</style>
