<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IconSpec, LibraryImage } from '@easydeck/core';
import {
  ICON_CANVAS,
  composeIcon,
  readIconLayers,
  readLayerSource,
  svgTextOf,
} from '@easydeck/engine/icons';

import IconLibrary from './IconLibrary.vue';
import type { UsedIcon } from './IconLibrary.vue';
import { isAnimated } from '../icons/rasterize.js';

/**
 * Where the pictures sit on the key, decided once.
 *
 * A picture fills the key edge to edge, which is right for a photograph and
 * wrong for a glyph — a mark meant to be read from a metre away, drawn corner
 * to corner. There is no setting for it and deliberately so: one that changed
 * how a picture met the key's edge was offered on every icon, where what people
 * wanted was for the picture to fill the key.
 *
 * So this is a moment rather than a setting. What comes out is an ordinary SVG
 * with the pictures inside it where they were put, and everything after this
 * point sees a picture.
 *
 * Not a photo editor, and not meant to become one: pictures are placed, sized
 * and stacked, and that is the whole of it. Layers exist here because two marks
 * on one key need to know which is in front, not because anyone is compositing.
 */

const props = defineProps<{
  /** The picture as chosen, which may already be one this window produced. */
  source: string;
  /** What the key shows behind them, so the placement is judged against it. */
  background?: string;
  userIcons: readonly LibraryImage[];
  profileIcons: readonly UsedIcon[];
  omittedIcons?: number;
}>();

const emit = defineEmits<{ apply: [source: string]; cancel: [] }>();

const { t } = useI18n();

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Layer {
  source: string;
  box: Box;
  /** Its own proportions, which decide what covering the key means for it. */
  ratio: number;
}

const canvas = ref<HTMLElement>();
const layers = ref<Layer[]>([]);
const active = ref(0);
const adding = ref(false);

const current = computed(() => layers.value[active.value]);

/**
 * The placement that changes nothing: one picture covering the key, cropped to
 * do it, which is what every picture does without this window.
 */
const arrival = ref<Box>({ x: 0, y: 0, width: ICON_CANVAS, height: ICON_CANVAS });

/**
 * Whether this is still the picture that came in, in the place it came in.
 *
 * Wrapping one that was not moved would make it a picture of its own — a second
 * copy in the profile, unrecognisable as the one already on seven other keys,
 * and one the library could no longer offer back.
 */
const untouched = computed(() => {
  const only = layers.value.length === 1 ? layers.value[0] : undefined;
  if (!only) return false;

  return (['x', 'y', 'width', 'height'] as const).every(
    (side) => Math.abs(only.box[side] - arrival.value[side]) < 0.5,
  );
});

/** How much of the key the chosen picture takes, along its longer side. */
const size = computed(() =>
  current.value ? Math.round((Math.max(current.value.box.width, current.value.box.height) / ICON_CANVAS) * 100) : 100,
);

onMounted(() => {
  const svg = svgTextOf(props.source);
  const placed = svg ? readIconLayers(svg) : [];

  if (placed.length > 0 && svg) {
    // Taken apart again, which is the point of recording the placement rather
    // than baking it and losing it.
    for (const layer of placed) {
      const source = readLayerSource(svg, layer.id);
      if (source) add(source, { ...layer });
    }
    return;
  }

  add(props.source);
});

/**
 * Puts a picture in, at its arrival placement unless told where.
 *
 * The proportions arrive later, since they come from loading the picture, and
 * the layer is found again by identity rather than by where it was put: a
 * layer removed or restacked while its picture was still loading would
 * otherwise hand its proportions to whichever one had taken its place.
 */
function add(picture: string, box?: Box): void {
  const first = layers.value.length === 0;
  const source = drawable(picture);
  const entry: Layer = { source, box: box ?? { ...arrival.value }, ratio: 1 };

  layers.value = [...layers.value, entry];
  active.value = layers.value.length - 1;

  const settle = (ratio: number): void => {
    const cover = coverBox(ratio);
    if (first && !box) arrival.value = cover;

    layers.value = layers.value.map((layer) =>
      layer === entry ? { ...layer, ratio, box: box ?? cover } : layer,
    );
  };

  const image = new Image();
  image.onload = () => {
    const ratio = image.naturalWidth / image.naturalHeight;
    settle(Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
  };
  image.onerror = () => settle(1);
  image.src = source;
}

/**
 * Something an `<img>` can actually load.
 *
 * A layer read back out of a composition arrives as markup, since that is what
 * it is inside the file. Given to an `<img>` unchanged it is taken for a
 * relative URL and fetched from the server, which answers with the page — so a
 * composition reopened for another go showed the placements it remembered and
 * none of the pictures in them.
 */
function drawable(source: string): string {
  return source.trimStart().startsWith('<')
    ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(source)))}`
    : source;
}

/** The box a picture of this shape needs to cover a square key. */
function coverBox(ratio: number): Box {
  const width = ratio >= 1 ? ICON_CANVAS * ratio : ICON_CANVAS;
  const height = ratio >= 1 ? ICON_CANVAS : ICON_CANVAS / ratio;

  return { x: (ICON_CANVAS - width) / 2, y: (ICON_CANVAS - height) / 2, width, height };
}

function patch(change: (box: Box, layer: Layer) => Box): void {
  layers.value = layers.value.map((layer, index) =>
    index === active.value ? { ...layer, box: change(layer.box, layer) } : layer,
  );
}

// --- moving, sizing, stacking --------------------------------------------

/**
 * Sized about its own middle, so a picture being made smaller stays where it
 * was put rather than creeping towards a corner.
 */
function resize(to: number): void {
  patch((box) => {
    const scale = to / Math.max(box.width, box.height);
    const width = box.width * scale;
    const height = box.height * scale;

    return {
      x: box.x + (box.width - width) / 2,
      y: box.y + (box.height - height) / 2,
      width,
      height,
    };
  });
}

function onWheel(event: WheelEvent): void {
  const box = current.value?.box;
  if (!box) return;

  const step = event.deltaY < 0 ? 1.06 : 1 / 1.06;
  resize(Math.min(ICON_CANVAS * 4, Math.max(4, Math.max(box.width, box.height) * step)));
}

function onDown(index: number, event: PointerEvent): void {
  active.value = index;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onMove(event: PointerEvent): void {
  if (!(event.buttons & 1)) return;

  const rect = canvas.value?.getBoundingClientRect();
  if (!rect) return;

  // Measured against the canvas rather than taken from the movement of the
  // element, which is being moved by this and would chase itself.
  const perPixel = ICON_CANVAS / rect.width;
  patch((box) => ({ ...box, x: box.x + event.movementX * perPixel, y: box.y + event.movementY * perPixel }));
}

function centre(): void {
  patch((box) => ({ ...box, x: (ICON_CANVAS - box.width) / 2, y: (ICON_CANVAS - box.height) / 2 }));
}

function fill(): void {
  patch((_box, layer) => coverBox(layer.ratio));
}

/** Later in the list is nearer the front, which is the order they are drawn. */
function raise(index: number, by: number): void {
  const to = index + by;
  if (to < 0 || to >= layers.value.length) return;

  const next = [...layers.value];
  [next[index], next[to]] = [next[to]!, next[index]!];
  layers.value = next;
  active.value = to;
}

function drop(index: number): void {
  layers.value = layers.value.filter((_layer, at) => at !== index);
  active.value = Math.max(0, Math.min(active.value, layers.value.length - 1));
}

/**
 * A picture added to the stack, never one that replaces it.
 *
 * Animations are refused: which path draws a picture is decided by its magic
 * bytes, and a GIF inside a wrapper is no longer a GIF — it would arrive on the
 * key as its own first frame, standing still.
 */
function added(icon: IconSpec): void {
  adding.value = false;
  if (!isAnimated(icon.source)) add(icon.source);
}

function apply(): void {
  if (layers.value.length === 0) return emit('cancel');
  if (untouched.value) return emit('apply', layers.value[0]!.source);

  const svg = composeIcon(layers.value.map((layer) => ({ source: layer.source, ...layer.box })));
  emit('apply', `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`);
}
</script>

<template>
  <div class="backdrop" @click.self="emit('cancel')" @keydown.esc="emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2>{{ t('iconEditor.title') }}</h2>
        <button type="button" class="close" :aria-label="t('settings.close')" @click="emit('cancel')">
          ✕
        </button>
      </header>

      <p class="muted hint">{{ t('iconEditor.hint') }}</p>

      <!-- The key itself, at the size the window can spare: the placement is a
           judgement about how a mark sits on a square, and it cannot be made
           against anything but the square. -->
      <div
        ref="canvas"
        class="key"
        :style="{ background: background ?? '#111318' }"
        @wheel.prevent="onWheel"
      >
        <img
          v-for="(layer, index) in layers"
          :key="index"
          class="placed"
          :class="{ current: index === active && layers.length > 1 }"
          :src="layer.source"
          :style="{
            left: `${layer.box.x}%`,
            top: `${layer.box.y}%`,
            width: `${layer.box.width}%`,
            height: `${layer.box.height}%`,
          }"
          alt=""
          draggable="false"
          @pointerdown="onDown(index, $event)"
          @pointermove="onMove"
        />
      </div>

      <div class="row">
        <label class="field">
          <span>{{ t('iconEditor.size') }}</span>
          <input
            type="range"
            min="4"
            max="200"
            :value="size"
            @input="resize((Number(($event.target as HTMLInputElement).value) / 100) * ICON_CANVAS)"
          />
          <span class="reading">{{ size }}%</span>
        </label>

        <button type="button" @click="centre">{{ t('iconEditor.centre') }}</button>
        <button type="button" @click="fill">{{ t('iconEditor.fill') }}</button>
      </div>

      <!--
        The stack, shown only once there is one. A single picture has nothing to
        be in front of, and a list of one would be a control explaining itself.
      -->
      <div v-if="layers.length > 1" class="stack">
        <div
          v-for="(layer, index) in [...layers].reverse()"
          :key="layers.length - 1 - index"
          class="entry"
          :class="{ current: layers.length - 1 - index === active }"
          @click="active = layers.length - 1 - index"
        >
          <img :src="layer.source" alt="" />
          <span class="muted">{{ layers.length - index }}</span>
          <button
            type="button"
            :title="t('iconEditor.forward')"
            :disabled="layers.length - 1 - index === layers.length - 1"
            @click.stop="raise(layers.length - 1 - index, 1)"
          >
            ↑
          </button>
          <button
            type="button"
            :title="t('iconEditor.back')"
            :disabled="layers.length - 1 - index === 0"
            @click.stop="raise(layers.length - 1 - index, -1)"
          >
            ↓
          </button>
          <button type="button" class="remove" :title="t('iconEditor.remove')" @click.stop="drop(layers.length - 1 - index)">
            ✕
          </button>
        </div>
      </div>

      <footer>
        <button type="button" class="add" @click="adding = true">{{ t('iconEditor.add') }}</button>
        <button type="button" @click="emit('cancel')">{{ t('prompt.cancel') }}</button>
        <button type="button" class="primary" @click="apply">{{ t('iconEditor.apply') }}</button>
      </footer>
    </div>

    <IconLibrary
      v-if="adding"
      :user-icons="userIcons"
      :profile-icons="profileIcons"
      :omitted="omittedIcons ?? 0"
      @pick="added"
      @close="adding = false"
    />
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
  width: 340px;
  max-width: 92vw;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
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

h2 { margin: 0; font-size: 14px; }
.close { background: none; border: none; color: var(--text-muted); padding: 2px 6px; }
.hint { margin: 0; font-size: 11px; }

/* Square, and the only square in the window: everything here is a judgement
   about how something sits on a key. */
.key {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  touch-action: none;
}

.placed {
  position: absolute;
  /* The whole picture inside the box that was dragged, which is what the box
     means. Cropping happens at the key's edge, by the box hanging over it. */
  object-fit: contain;
  cursor: grab;
  user-select: none;
}

.placed:active { cursor: grabbing; }

/* Only while there is something to tell apart. */
.placed.current { outline: 1px dashed var(--accent); outline-offset: 1px; }

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.field input { flex: 1; min-width: 0; }

.reading {
  width: 4ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Front at the top, which is how a stack is drawn everywhere else. */
.stack {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 140px;
  overflow-y: auto;
}

.entry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px;
  border: 1px solid transparent;
  border-radius: 7px;
  font-size: 11px;
  cursor: pointer;
}

.entry.current { border-color: var(--accent); background: var(--accent-soft); }

.entry img {
  width: 24px;
  height: 24px;
  object-fit: contain;
  background: var(--surface-2);
  border-radius: 4px;
}

.entry span { flex: 1; }

.entry button {
  border: none;
  background: none;
  color: var(--text-muted);
  padding: 2px 4px;
  font-size: 11px;
}

.entry button:hover:not(:disabled) { color: var(--text); }
.entry .remove:hover { color: var(--danger); }

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Away from the two that close the window, since it does neither. */
.add { margin-right: auto; }

.primary {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
