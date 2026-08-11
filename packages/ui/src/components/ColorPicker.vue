<script setup lang="ts">
import { computed, ref } from 'vue';

/**
 * A colour, as a swatch and as the six characters people actually trade in.
 *
 * The swatch alone was the whole control, which meant a colour could be
 * pointed at and never named: no way to type the hex from a brand guide, none
 * to copy one out of a key and into another, and no way to read what a key was
 * set to without opening the system picker. A palette of one program matching
 * a palette of another is done by pasting hex, not by eye.
 *
 * The two halves feed each other. The swatch is authoritative about what is
 * currently set; the field is a draft until it parses, so a half-typed `#e2` is
 * neither applied nor thrown away while somebody is mid-word.
 */

const props = defineProps<{
  /** What is set now, or nothing at all. */
  modelValue?: string;
  /** What the key would use anyway, shown while nothing is set. */
  fallback?: string;
  title?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

/** Three, four, six or eight hex digits, with or without the `#`. */
const HEX = /^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Held while typing, so a repaint cannot rewrite a half-typed colour.
 *
 * The editor redraws whenever a variable changes — once a second with a
 * processor gauge on screen — and a field bound straight to the model loses
 * whatever was being typed each time.
 */
const draft = ref<string>();

const shown = computed(() => draft.value ?? props.modelValue ?? '');

/**
 * What the swatch shows.
 *
 * Cut to six digits because `<input type="color">` has no notion of alpha and
 * shows black for anything it cannot parse — a colour with alpha would read as
 * "not set" rather than as itself.
 */
const swatch = computed(() => {
  const full = expand(props.modelValue ?? props.fallback ?? '');
  return full ? full.slice(0, 7) : (props.fallback ?? '#000000');
});

/** Whether what is in the field could be a colour, for the sake of saying so. */
const understood = computed(() => shown.value === '' || expand(shown.value) !== undefined);

/** `#abc` and `abc` alike become `#aabbcc`; anything else is not a colour. */
function expand(text: string): string | undefined {
  const trimmed = text.trim();
  if (!HEX.test(trimmed)) return undefined;

  const digits = trimmed.replace('#', '').toLowerCase();
  const full = digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return `#${full}`;
}

function typeHex(text: string): void {
  draft.value = text;

  const colour = expand(text);
  if (colour) emit('update:modelValue', colour);
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

function pick(value: string): void {
  draft.value = undefined;
  emit('update:modelValue', value);
}
</script>

<template>
  <span class="picker" :title="title">
    <input
      type="color"
      class="swatch"
      :value="swatch"
      @input="pick(($event.target as HTMLInputElement).value)"
    />
    <input
      type="text"
      class="hex"
      spellcheck="false"
      autocomplete="off"
      :class="{ bad: !understood }"
      :placeholder="fallback ?? '#000000'"
      :value="shown"
      @input="typeHex(($event.target as HTMLInputElement).value)"
      @blur="settle"
      @keydown.enter="settle"
    />
  </span>
</template>

<style scoped>
.picker {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Border, radius and background come from the global input rules, so a swatch
   here matches every other field on the page. */
.swatch {
  flex: none;
  width: 30px;
  height: 30px;
  padding: 2px;
  cursor: pointer;
}

.hex {
  /* Room for eight digits and a hash, and no more: this field holds one thing,
     and a wide box beside a swatch reads as the important half. */
  flex: none;
  width: 9ch;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  text-transform: lowercase;
}

/* Said quietly. What is typed is not applied until it parses, so this is a
   note about the field rather than a report of anything going wrong. */
.hex.bad {
  border-color: var(--danger);
}
</style>
