<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

/**
 * A colour, chosen the way colours are chosen everywhere else: one button, and
 * a panel behind it holding the whole space at once.
 *
 * The control used to be a swatch beside a hex field, which put two thirds of a
 * picker on screen permanently and still could not answer "a bit more red than
 * that". The panel says it three ways — a square to point at, three channels to
 * count in, and the six characters people trade between programs — and all
 * three are the same colour, so whichever one someone thinks in is the one they
 * can use.
 *
 * Hue, saturation and value are held here rather than re-derived from the hex
 * each time. Dragging down to black or left to white throws away the hue, and a
 * picker that forgets which colour you were darkening is a picker you have to
 * start over in.
 */

const props = defineProps<{
  /** What is set now, or nothing at all. */
  modelValue?: string;
  /** What the key would use anyway, shown while nothing is set. */
  fallback?: string;
  title?: string;
  /**
   * Names the button, and widens it to fit the word.
   *
   * Without one the control is a square that says what it is by showing the
   * colour. Standing in a column beside two other buttons it has to say which
   * colour it is — the background's or the text's — and only a word does that.
   */
  label?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const { t } = useI18n();

/** Three, four, six or eight hex digits, with or without the `#`. */
const HEX = /^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const open = ref(false);
const anchor = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const square = ref<HTMLElement>();
const at = ref({ x: 0, y: 0 });

/** The panel's own idea of the colour, in the terms the square is drawn in. */
const hsv = ref<Hsv>({ h: 0, s: 0, v: 0 });

/**
 * Held while typing in the hex field, so a repaint cannot rewrite a half-typed
 * colour: the editor redraws whenever a variable changes, once a second with a
 * processor gauge on screen.
 */
const draft = ref<string>();

/** What is set, or what would be used anyway — six digits either way. */
const current = computed(
  () => expand(props.modelValue ?? '') ?? expand(props.fallback ?? '') ?? '#000000',
);

/**
 * Transparency is carried through rather than edited.
 *
 * Nothing in the program offers a way to set it, but a profile may hold it, and
 * a picker that dropped it would quietly turn a half-faded key opaque the first
 * time someone nudged its hue.
 */
const alpha = computed(() => {
  const full = expand(props.modelValue ?? '');
  return full && full.length === 9 ? full.slice(7) : '';
});

const rgb = computed(() => toRgb(current.value));

const hex = computed(() => draft.value ?? current.value.slice(0, 7));

/** Whether what is in the field could be a colour, for the sake of saying so. */
const understood = computed(() => hex.value === '' || expand(hex.value) !== undefined);

/** The colour the square fades to on the right, at full strength. */
const hue = computed(() => toHex(hsvToRgb({ h: hsv.value.h, s: 1, v: 1 })));

const handle = computed(() => ({
  left: `${hsv.value.s * 100}%`,
  top: `${(1 - hsv.value.v) * 100}%`,
}));

/**
 * Black on a light colour, white on a dark one.
 *
 * The button *is* the swatch, so the palette on it has to stay legible against
 * whatever it is showing.
 */
const contrast = computed(() => {
  const { r, g, b } = rgb.value;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#000000' : '#ffffff';
});

const panelStyle = computed(() => ({ left: `${at.value.x}px`, top: `${at.value.y}px` }));

// --- colour arithmetic ---------------------------------------------------

/** `#abc` and `abc` alike become `#aabbcc`; anything else is not a colour. */
function expand(text: string): string | undefined {
  const trimmed = text.trim();
  if (!HEX.test(trimmed)) return undefined;

  const digits = trimmed.replace('#', '').toLowerCase();
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return `#${full}`;
}

function toRgb(colour: string): Rgb {
  const digits = colour.slice(1);
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const pair = (value: number): string =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${pair(r)}${pair(g)}${pair(b)}`;
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const span = max - Math.min(red, green, blue);

  let h = 0;
  if (span !== 0) {
    if (max === red) h = ((green - blue) / span) % 6;
    else if (max === green) h = (blue - red) / span + 2;
    else h = (red - green) / span + 4;
  }

  return {
    h: (Math.round(h * 60) + 360) % 360,
    s: max === 0 ? 0 : span / max,
    v: max,
  };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const sector = ((h % 360) + 360) % 360;
  const chroma = v * s;
  const middle = chroma * (1 - Math.abs(((sector / 60) % 2) - 1));
  const base = v - chroma;

  const [r, g, b] =
    sector < 60
      ? [chroma, middle, 0]
      : sector < 120
        ? [middle, chroma, 0]
        : sector < 180
          ? [0, chroma, middle]
          : sector < 240
            ? [0, middle, chroma]
            : sector < 300
              ? [middle, 0, chroma]
              : [chroma, 0, middle];

  return { r: (r + base) * 255, g: (g + base) * 255, b: (b + base) * 255 };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// --- editing -------------------------------------------------------------

/** The one place a colour leaves this component, so alpha is kept in one place. */
function apply(colour: string): void {
  emit('update:modelValue', `${colour}${alpha.value}`);
}

function applyHsv(next: Hsv): void {
  hsv.value = next;
  apply(toHex(hsvToRgb(next)));
}

function setChannel(channel: keyof Rgb, text: string): void {
  const value = Number.parseInt(text, 10);
  if (Number.isNaN(value)) return;

  const next = { ...rgb.value, [channel]: clamp(value, 0, 255) };
  hsv.value = keepHue(rgbToHsv(next));
  apply(toHex(next));
}

function typeHex(text: string): void {
  draft.value = text;

  const colour = expand(text);
  if (!colour) return;

  hsv.value = keepHue(rgbToHsv(toRgb(colour)));
  apply(colour.slice(0, 7));
}

/**
 * Typing stops, and the field goes back to agreeing with the colour.
 *
 * Something unparseable is dropped rather than kept: it was never applied, and
 * leaving it on screen would show a colour that is not the one in use.
 */
function settle(): void {
  draft.value = undefined;
}

/**
 * Grey has no hue of its own, so it borrows the one on screen.
 *
 * Typing `000000` and then reaching for the rainbow should leave the slider
 * where it was rather than snapping it to red.
 */
function keepHue(next: Hsv): Hsv {
  return next.s === 0 || next.v === 0 ? { ...next, h: hsv.value.h } : next;
}

// --- the panel -----------------------------------------------------------

function toggle(): void {
  if (open.value) return close();

  hsv.value = keepHue(rgbToHsv(rgb.value));
  draft.value = undefined;
  place();
  open.value = true;

  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);

  // Measured rather than guessed: the panel is one fixed size, but the field it
  // belongs to may sit anywhere, including the bottom row of a dialog.
  void nextTick(place);
}

function close(): void {
  open.value = false;
  draft.value = undefined;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
}

/** Under the button, and pulled back onto the screen where it would not fit. */
function place(): void {
  const trigger = anchor.value?.getBoundingClientRect();
  if (!trigger) return;

  const size = panel.value?.getBoundingClientRect();
  const width = size?.width ?? 236;
  const height = size?.height ?? 300;

  const below = trigger.bottom + 6;
  at.value = {
    x: clamp(trigger.left, 8, Math.max(8, window.innerWidth - width - 8)),
    y: below + height > window.innerHeight - 8 ? Math.max(8, trigger.top - height - 6) : below,
  };
}

function onOutside(event: MouseEvent): void {
  const target = event.target as Node;
  if (panel.value?.contains(target) || anchor.value?.contains(target)) return;
  close();
}

/**
 * Escape shuts the panel and stops there.
 *
 * The editor this opens over closes on Escape too, and one press dismissing
 * both would throw away a key someone was still working on.
 */
function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;

  event.stopPropagation();
  close();
}

onBeforeUnmount(close);

/** Reopening on another field shows that field's colour, not the last one. */
watch(current, (colour) => {
  if (open.value && toHex(hsvToRgb(hsv.value)) !== colour.slice(0, 7)) {
    hsv.value = keepHue(rgbToHsv(toRgb(colour)));
  }
});

// --- the square ----------------------------------------------------------

function onSquareDown(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  aim(event);
}

function onSquareMove(event: PointerEvent): void {
  // The button is held down: `buttons` rather than a flag of our own, so a
  // release outside the window cannot leave the square dragging forever.
  if (event.buttons & 1) aim(event);
}

/**
 * Read from the square's own rectangle, not from `offsetX`, which reports
 * against whatever child the pointer happens to be over — the handle included.
 */
function aim(event: PointerEvent): void {
  const box = square.value?.getBoundingClientRect();
  if (!box) return;

  applyHsv({
    h: hsv.value.h,
    s: clamp((event.clientX - box.left) / box.width, 0, 1),
    v: 1 - clamp((event.clientY - box.top) / box.height, 0, 1),
  });
}
</script>

<template>
  <span ref="anchor" class="picker" :class="{ wide: label }">
    <button
      type="button"
      class="trigger"
      :class="{ wide: label }"
      :style="{ background: current, color: contrast }"
      :title="title ?? t('color.open')"
      :aria-label="title ?? t('color.open')"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <!-- A palette rather than a letter: the button carries the colour as its
           own background, and any glyph on top has to survive every one of them. -->
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M8 1.6a6.4 6.4 0 0 0 0 12.8c.7 0 1.2-.5 1.2-1.2 0-.3-.1-.6-.3-.8a1.2 1.2 0 0 1 .9-2h1.4a3.2 3.2 0 0 0 3.2-3.2C14.4 4.1 11.5 1.6 8 1.6Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
        />
        <circle cx="5" cy="7" r="1" fill="currentColor" />
        <circle cx="8" cy="4.9" r="1" fill="currentColor" />
        <circle cx="11.1" cy="7" r="1" fill="currentColor" />
      </svg>

      <span v-if="label" class="name">{{ label }}</span>
    </button>

    <!--
      Teleported, and fixed once there: every field this control appears in
      lives inside a dialog column that scrolls, and a panel positioned within
      one would be cut off at the first edge it met.
    -->
    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="panel"
        :style="panelStyle"
        role="dialog"
        :aria-label="t('color.open')"
      >
        <div
          ref="square"
          class="square"
          :style="{ backgroundColor: hue }"
          @pointerdown="onSquareDown"
          @pointermove="onSquareMove"
        >
          <span class="handle" :style="handle" />
        </div>

        <input
          type="range"
          class="hue"
          min="0"
          max="360"
          :title="t('color.hue')"
          :aria-label="t('color.hue')"
          :value="hsv.h"
          @input="applyHsv({ ...hsv, h: Number(($event.target as HTMLInputElement).value) })"
        />

        <div class="channels">
          <label v-for="channel in (['r', 'g', 'b'] as const)" :key="channel" class="channel">
            <span>{{ t(`color.${channel}`) }}</span>
            <input
              type="number"
              min="0"
              max="255"
              :value="Math.round(rgb[channel])"
              @input="setChannel(channel, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <label class="field">
          <span>{{ t('color.hex') }}</span>
          <input
            type="text"
            class="hex"
            spellcheck="false"
            autocomplete="off"
            :class="{ bad: !understood }"
            placeholder="#000000"
            :value="hex"
            @input="typeHex(($event.target as HTMLInputElement).value)"
            @blur="settle"
            @keydown.enter="settle"
          />
        </label>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.picker {
  display: inline-flex;
}

/* Takes the width it is given rather than claiming any: in a column it is
   stretched to the column, and growing is the caller's decision in a row. */
.picker.wide {
  display: flex;
  min-width: 0;
}

/* The swatch and the button are the same thing: what is set is what you press
   to change it, and nothing else has to be on screen to say so. */
.trigger {
  flex: none;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
}

/* Named, and the colour it is named for behind the word: the button reports
   its own value, which is what keeps three of them in a column apart. */
.trigger.wide {
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  font-size: 12px;
}

.trigger .name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  /* Same reasoning as the glyph's shadow: the colour underneath is arbitrary. */
  text-shadow: 0 0 2px rgb(0 0 0 / 0.25);
}

.trigger svg {
  flex: none;
  width: 17px;
  height: 17px;
  /* The colour under it may be anything; a shadow keeps the outline readable
     over the ones that come closest to the glyph's own. */
  filter: drop-shadow(0 0 1px rgb(0 0 0 / 0.25));
}

.panel {
  position: fixed;
  z-index: 30;
  width: 236px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 12px 32px var(--shadow);
}

/* White to the hue across, full brightness to black down: the two ramps that
   turn a flat rectangle into every shade of one colour. */
.square {
  position: relative;
  height: 132px;
  border-radius: 6px;
  cursor: crosshair;
  touch-action: none;
  background-image:
    linear-gradient(to top, #000000, rgb(0 0 0 / 0)),
    linear-gradient(to right, #ffffff, rgb(255 255 255 / 0));
}

.handle {
  position: absolute;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.45);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.hue {
  width: 100%;
  height: 12px;
  margin: 0;
  padding: 0;
  appearance: none;
  border-radius: 6px;
  cursor: pointer;
  background: linear-gradient(
    to right,
    #ff0000,
    #ffff00,
    #00ff00,
    #00ffff,
    #0000ff,
    #ff00ff,
    #ff0000
  );
}

.hue::-webkit-slider-thumb {
  appearance: none;
  width: 7px;
  height: 16px;
  border-radius: 3px;
  background: var(--surface-1);
  border: 1px solid var(--border-strong);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
}

.hue::-moz-range-thumb {
  width: 7px;
  height: 16px;
  border-radius: 3px;
  background: var(--surface-1);
  border: 1px solid var(--border-strong);
}

.channels {
  display: flex;
  gap: 6px;
}

.channel,
.field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.channel {
  flex: 1;
}

.channel input {
  width: 100%;
  min-width: 0;
  padding: 3px 4px;
  font-size: 12px;
  text-align: center;
}

.hex {
  flex: 1;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  text-transform: lowercase;
}

/* Said quietly. What is typed is not applied until it parses, so this is a
   note about the field rather than a report of anything going wrong. */
.hex.bad {
  border-color: var(--danger);
}
</style>
