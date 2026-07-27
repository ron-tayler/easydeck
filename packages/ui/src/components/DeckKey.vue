<script setup lang="ts">
import { computed } from 'vue';
import type { KeyView } from '@easydeck/core';

const props = defineProps<{
  index: number;
  view?: KeyView;
  pressed: boolean;
}>();

defineEmits<{ press: [key: number] }>();

/**
 * Mirrors the renderer's own rules rather than inventing new ones: the same
 * background, the same label position, the same default colours. It is a
 * preview, so looking like the panel matters more than looking like the web.
 */
const background = computed(() => props.view?.visual.background ?? '#111318');
const label = computed(() => props.view?.visual.label);
const labelColor = computed(() => label.value?.color ?? '#ffffff');

const justify = computed(() => {
  const position = label.value?.position ?? (props.view?.visual.icon ? 'flex-end' : 'center');
  if (position === 'top') return 'flex-start';
  if (position === 'bottom') return 'flex-end';
  return position === 'flex-end' ? 'flex-end' : 'center';
});

/**
 * Label sizes are authored against a 100px key, exactly as the device
 * renderer treats them. Container query units reproduce that: `1cqw` is one
 * percent of the key's width, so an authored size lands at the same relative
 * scale here as it does on the panel, whatever size the preview is drawn at.
 */
const fontSize = computed(() => `calc(${label.value?.fontSize ?? 22} * 1cqw)`);
</script>

<template>
  <button
    class="key"
    :class="{ pressed, empty: !view }"
    :style="{ background }"
    type="button"
    @click="$emit('press', index)"
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

.key.empty { background: transparent !important; border-style: dashed; cursor: default; }

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
  /* Padding scales with the key too, so the text keeps its margins at any
     preview size. The wider top gap clears the key number. */
  padding: 14cqw 5cqw 6cqw;
  text-align: center;
  line-height: 1.15;
  word-break: break-word;
  flex-direction: column;
  font-weight: 500;
}
</style>
