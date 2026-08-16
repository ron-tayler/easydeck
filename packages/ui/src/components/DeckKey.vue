<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { KeyView } from '@easydeck/protocol';

import { backgroundCss } from '@easydeck/engine/background';
import { drawableIcon } from '@easydeck/engine/icons';

import KeyLabel from './KeyLabel.vue';

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
  /**
   * The page this key belongs to, carried in the drag itself.
   *
   * Dragging can navigate — resting on a folder opens it — so by the time the
   * key is let go, the page it came from is no longer the one on screen.
   * Reading it at the drop would name the wrong page every time.
   */
  pageId?: string;
  pressed: boolean;
  selected: boolean;
  /** Whether this key owns a button, and so can have its picture stretched. */
  resizable?: boolean;
  /**
   * Whether this key stays put.
   *
   * Set on a deck, where a long press is a gesture and a browser that decides
   * it was the start of a drag keeps the release for itself — leaving the key
   * held down and the deck deaf to everything after it.
   *
   * Phrased as "fixed" rather than "movable" on purpose: an absent boolean
   * prop arrives as `false`, so the default has to be the configurator's
   * behaviour. As `movable` it silently turned dragging off for the whole
   * grid the moment the prop was added.
   */
  fixed?: boolean;
}>();

const emit = defineEmits<{
  select: [key: number];
  menu: [payload: { key: number; x: number; y: number }];
  dropAction: [payload: { key: number; actionType: string; label: string }];
  dropPreset: [payload: { key: number; pluginId: string; name: string }];
  dropKey: [payload: { from: { pageId?: string; key: number }; to: number }];
  dragStart: [payload: { pageId?: string; key: number }];
  dragEnd: [];
  resizeStart: [payload: { key: number; axis: 'col' | 'row' | 'both' }];
}>();

const over = ref(false);

/**
 * Mirrors the renderer's own rules rather than inventing new ones: the same
 * background, the same label position, the same default colours. It is a
 * preview, so looking like the panel matters more than looking like the web.
 */
const background = computed(() => backgroundCss(props.view?.visual.background));
const label = computed(() => props.view?.visual.label);
const icon = computed(() => props.view?.visual.icon);

/**
 * The picture with its parameters filled in, done here rather than upstream.
 *
 * The daemon sends the icon exactly as the profile stores it, with the values
 * beside it — so the picture keeps one address and stays cached however fast
 * the needle moves, and the substituting costs a string replace per repaint.
 *
 * An `<img>` rather than inline markup, deliberately: an SVG inside one is
 * rendered with no scripts and no external fetches, so icons arriving inside
 * somebody else's plugin pack never need sanitising. It is also why the icon's
 * ink is written into the picture rather than left to the page's own `color`:
 * an `<img>` is a document of its own, and nothing of ours cascades into it.
 */
const iconSource = computed(() => (icon.value ? drawableIcon(icon.value) : undefined));
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

function onDragStart(event: DragEvent): void {
  if (!props.view) return;

  const from = { pageId: props.pageId, key: props.index };
  event.dataTransfer?.setData('application/x-easydeck-key', JSON.stringify(from));
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';

  emit('dragStart', from);
}

function onDragOver(event: DragEvent): void {
  const types = event.dataTransfer?.types ?? [];
  const accepted = [
    'application/x-easydeck-action',
    'application/x-easydeck-preset',
    'application/x-easydeck-key',
  ];
  if (!accepted.some((type) => types.includes(type))) return;
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

  const preset = event.dataTransfer?.getData('application/x-easydeck-preset');
  if (preset) {
    const { pluginId, name } = JSON.parse(preset) as { pluginId: string; name: string };
    emit('dropPreset', { key: props.index, pluginId, name });
    return;
  }

  const from = event.dataTransfer?.getData('application/x-easydeck-key');
  if (!from) return;

  try {
    emit('dropKey', { from: JSON.parse(from) as { pageId?: string; key: number }, to: props.index });
  } catch {
    // Something else's drag data wearing our type; nothing to move.
  }
}
</script>

<template>
  <button
    class="key"
    :class="{ pressed, empty: !view, selected, over }"
    :style="{ background, borderRadius: corners }"
    type="button"
    :draggable="!fixed && Boolean(view)"
    @click="emit('select', index)"
    @contextmenu.prevent="emit('menu', { key: index, x: $event.clientX, y: $event.clientY })"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @dragleave="over = false"
    @dragend="emit('dragEnd')"
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
      draggable="false"
      :src="backdrop.source"
      :style="{
        width: `calc(${backdrop.cols * 100}% + ${(backdrop.cols - 1) * KEY_GAP}px)`,
        height: `calc(${backdrop.rows * 100}% + ${(backdrop.rows - 1) * KEY_GAP}px)`,
        left: `calc(${-backdrop.col * 100}% - ${backdrop.col * KEY_GAP}px)`,
        top: `calc(${-backdrop.row * 100}% - ${backdrop.row * KEY_GAP}px)`,
      }"
      alt=""
    />

    <!-- An <img> rather than a background: a GIF only animates when the
         browser treats it as an image, and seeing it move here is the whole
         point of choosing one. -->
    <img
      v-if="icon"
      class="icon"
      draggable="false"
      :src="iconSource"
      alt=""
    />
    <!-- The same mark the panel draws, for the same reason: a press that
         failed must say so where the finger was. -->
    <svg v-if="view?.visual.alert" class="alert" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 L23 21 L1 21 Z" fill="#f5c518" stroke="#1a1a1a" stroke-width="1.6" />
      <rect x="11" y="8.5" width="2" height="7" fill="#1a1a1a" />
      <circle cx="12" cy="18" r="1.3" fill="#1a1a1a" />
    </svg>

    <KeyLabel
      v-if="label"
      :label="label"
      :has-picture="Boolean(view?.visual.icon ?? view?.visual.backdrop)"
    />

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

/*
 * Mirrors the device, and by the same amount: the panel redraws a held key at
 * four fifths of its size, so the preview shrinks by exactly as much. A
 * preview that acknowledged a press differently would be lying about the one
 * thing it exists to show.
 */
.key.pressed {
  transform: scale(0.8);
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
  /* Both dimensions, or `object-fit` has nothing to fit against: with only a
     width the picture kept its own proportions and spilled past the key
     instead of being cropped to it. */
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.alert {
  position: absolute;
  top: 6%;
  right: 6%;
  width: 34%;
  height: 34%;
  pointer-events: none;
}

</style>
