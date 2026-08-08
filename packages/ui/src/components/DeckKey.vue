<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { KeyView } from '@easydeck/core';

const { t } = useI18n();

/**
 * The grid's own gap, in pixels — must match `gap` in DeckGrid.
 *
 * A stretched picture is laid out across the whole region including the space
 * between keys, exactly as the device does it. Ignoring the gap here would
 * make the window disagree with the panel about where the picture sits, which
 * is the one thing a preview must never do.
 */
const KEY_GAP = 10;

const props = defineProps<{
  index: number;
  view?: KeyView;
  pressed: boolean;
  selected: boolean;
  /** Whether this key owns a button, and so can have its picture stretched. */
  resizable?: boolean;
}>();

const emit = defineEmits<{
  select: [key: number];
  menu: [payload: { key: number; x: number; y: number }];
  dropAction: [payload: { key: number; actionType: string; label: string }];
  dropKey: [payload: { from: number; to: number }];
  resizeStart: [payload: { key: number; axis: 'col' | 'row' | 'both' }];
}>();

const over = ref(false);

/**
 * Mirrors the renderer's own rules rather than inventing new ones: the same
 * background, the same label position, the same default colours. It is a
 * preview, so looking like the panel matters more than looking like the web.
 */
const background = computed(() => props.view?.visual.background ?? '#111318');
const label = computed(() => props.view?.visual.label);
const icon = computed(() => props.view?.visual.icon);
const backdrop = computed(() => props.view?.visual.backdrop);

/**
 * Only a merged region's outer corners are rounded, matching the device.
 * Rounding an inner one would bite a notch out of the picture at every seam.
 */
const corners = computed(() => {
  const slice = backdrop.value;
  if (!slice) return undefined;

  const round = (yes: boolean) => (yes ? '12px' : '0');
  return [
    round(slice.col === 0 && slice.row === 0),
    round(slice.col === slice.cols - 1 && slice.row === 0),
    round(slice.col === slice.cols - 1 && slice.row === slice.rows - 1),
    round(slice.col === 0 && slice.row === slice.rows - 1),
  ].join(' ');
});
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
const fontSize = computed(
  () => `calc(${label.value?.fontSize ?? 22} * 1cqw * var(--key-label-scale))`,
);

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
    :style="{ background, borderRadius: corners }"
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

    <!--
      This key's cell of a picture spanning several keys. The image box is the
      whole region and is then shifted, which is the same arithmetic the device
      renderer does — cropping a pre-scaled tile instead would put the seams in
      a slightly different place here than on the panel.
    -->
    <img
      v-if="backdrop"
      class="backdrop"
      :src="backdrop.source"
      :style="{
        width: `calc(${backdrop.cols * 100}% + ${(backdrop.cols - 1) * KEY_GAP}px)`,
        height: `calc(${backdrop.rows * 100}% + ${(backdrop.rows - 1) * KEY_GAP}px)`,
        left: `calc(${-backdrop.col * 100}% - ${backdrop.col * KEY_GAP}px)`,
        top: `calc(${-backdrop.row * 100}% - ${backdrop.row * KEY_GAP}px)`,
        objectFit: backdrop.fit ?? 'cover',
      }"
      alt=""
    />

    <!-- An <img> rather than a background: a GIF only animates when the
         browser treats it as an image, and seeing it move here is the whole
         point of choosing one. -->
    <img
      v-if="icon"
      class="icon"
      :src="icon.source"
      :style="{ objectFit: icon.fit ?? 'cover' }"
      alt=""
    />
    <span v-if="label" class="label" :style="{ color: labelColor, justifyContent: justify, fontSize }">
      {{ label.text }}
    </span>

    <!--
      Grips on the right and bottom edges, appearing on hover. Dragging one
      stretches the picture over the neighbouring keys — the gesture a merged
      cell already implies, so it needs no explaining.

      `mousedown.stop` keeps the grip from also selecting or dragging the key.
    -->
    <template v-if="resizable">
      <span
        class="grip right"
        :title="t('deck.stretch')"
        @mousedown.stop.prevent="emit('resizeStart', { key: index, axis: 'col' })"
      />
      <span
        class="grip bottom"
        :title="t('deck.stretch')"
        @mousedown.stop.prevent="emit('resizeStart', { key: index, axis: 'row' })"
      />
      <span
        class="grip corner"
        :title="t('deck.stretch')"
        @mousedown.stop.prevent="emit('resizeStart', { key: index, axis: 'both' })"
      />
    </template>
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

.backdrop {
  position: absolute;
  pointer-events: none;
}

/* Hidden until the key is hovered: fifteen permanent grips would read as
   fifteen more controls rather than as an affordance. */
.grip {
  position: absolute;
  opacity: 0;
  background: var(--accent);
  border-radius: 3px;
  transition: opacity 90ms ease;
  z-index: 2;
}

.key:hover .grip { opacity: 0.55; }
.grip:hover { opacity: 1 !important; }

.right {
  top: 30%;
  bottom: 30%;
  right: -3px;
  width: 6px;
  cursor: ew-resize;
}

.bottom {
  left: 30%;
  right: 30%;
  bottom: -3px;
  height: 6px;
  cursor: ns-resize;
}

.corner {
  right: -3px;
  bottom: -3px;
  width: 8px;
  height: 8px;
  cursor: nwse-resize;
}

.icon {
  position: absolute;
  inset: 0;
  width: 100%;
  margin: auto;
  pointer-events: none;
}

.label {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14cqw 5cqw 6cqw;
  text-align: center;
  line-height: 1.15;
  word-break: break-word;
  flex-direction: column;
  /* The device's own font at its own weight; anything else makes the same
     nominal size read as a different size. */
  font-family: 'EasyDeck Sans', system-ui, sans-serif;
  font-weight: 400;
  pointer-events: none;
}
</style>
