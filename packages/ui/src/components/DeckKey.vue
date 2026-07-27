<script setup lang="ts">
import { computed, ref } from 'vue';
import type { KeyView } from '@easydeck/core';

const props = defineProps<{
  index: number;
  view?: KeyView;
  pressed: boolean;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [key: number];
  menu: [payload: { key: number; x: number; y: number }];
  dropAction: [payload: { key: number; actionType: string; label: string }];
  dropKey: [payload: { from: number; to: number }];
}>();

const over = ref(false);

/**
 * Mirrors the renderer's own rules rather than inventing new ones: the same
 * background, the same label position, the same default colours. It is a
 * preview, so looking like the panel matters more than looking like the web.
 */
const background = computed(() => props.view?.visual.background ?? '#111318');
const label = computed(() => props.view?.visual.label);
const labelColor = computed(() => label.value?.color ?? '#ffffff');

const justify = computed(() => {
  const position = label.value?.position ?? (props.view?.visual.icon ? 'bottom' : 'center');
  if (position === 'top') return 'flex-start';
  if (position === 'bottom') return 'flex-end';
  return 'center';
});

/**
 * Label sizes are authored against a 100px key, exactly as the device
 * renderer treats them. Container query units reproduce that: `1cqw` is one
 * percent of the key's width, so an authored size lands at the same relative
 * scale here as it does on the panel.
 */
const fontSize = computed(() => `calc(${label.value?.fontSize ?? 22} * 1cqw)`);

function onDragStart(event: DragEvent): void {
  if (!props.view) return;
  event.dataTransfer?.setData('application/x-easydeck-key', String(props.index));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}

function onDragOver(event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  if (!types.includes('application/x-easydeck-action') && !types.includes('application/x-easydeck-key')) {
    return;
  }
  event.preventDefault();
  over.value = true;
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  over.value = false;

  const action = event.dataTransfer?.getData('application/x-easydeck-action');
  if (action) {
    const { type, label: name } = JSON.parse(action) as { type: string; label: string };
    emit('dropAction', { key: props.index, actionType: type, label: name });
    return;
  }

  const from = event.dataTransfer?.getData('application/x-easydeck-key');
  if (from) emit('dropKey', { from: Number(from), to: props.index });
}
</script>

<template>
  <button
    class="key"
    :class="{ pressed, empty: !view, selected, over }"
    :style="{ background }"
    type="button"
    :draggable="Boolean(view)"
    @click="emit('select', index)"
    @contextmenu.prevent="emit('menu', { key: index, x: $event.clientX, y: $event.clientY })"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @dragleave="over = false"
    @drop="onDrop"
  >
    <span class="index">{{ index + 1 }}</span>
    <span v-if="label" class="label" :style="{ color: labelColor, justifyContent: justify, fontSize }">
      {{ label.text }}
    </span>
  </button>
</template>

<style scoped>
.key {
  position: relative;
  aspect-ratio: 1;
  container-type: inline-size;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  transition: transform 90ms ease, box-shadow 120ms ease;
  font: inherit;
}

.key:hover { border-color: var(--border-strong); }
.key:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.key.empty { background: transparent !important; border-style: dashed; }

/* Selection is what copy and paste act on, so it has to be unmistakable. */
.key.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.key.over {
  border-color: var(--accent);
  border-style: solid;
  box-shadow: inset 0 0 0 2px var(--accent);
}

/* Mirrors the device: a key held down reads instantly, without a legend. */
.key.pressed {
  transform: scale(0.94);
  box-shadow: 0 0 0 2px var(--accent), 0 0 18px rgb(56 139 253 / 45%);
}

.index {
  position: absolute;
  top: 3cqw;
  left: 5cqw;
  font-size: 9cqw;
  color: rgb(255 255 255 / 45%);
  pointer-events: none;
}

.label {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14cqw 5cqw 6cqw;
  text-align: center;
  line-height: 1.15;
  word-break: break-word;
  flex-direction: column;
  font-weight: 500;
  pointer-events: none;
}
</style>
