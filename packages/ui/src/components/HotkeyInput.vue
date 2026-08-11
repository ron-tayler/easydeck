<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { KeyGroup, KeyboardKey, LocalizedText } from '@easydeck/core';
import {
  KEYBOARD_KEYS,
  MAX_HOTKEY_KEYS,
  formatHotkey,
  keyboardKey,
  parseHotkey,
} from '@easydeck/engine/keys';

/**
 * A key combination, chosen rather than typed.
 *
 * It used to be a text box holding `ctrl+shift+m`, which asked a person to
 * know how this program spells a key and told them nothing when they got it
 * wrong — the button simply did nothing when pressed. A list cannot be
 * misspelled, and it doubles as the answer to "what can I even put here".
 *
 * The keys are positions on a US keyboard, so a combination means the same
 * thing whatever layout is active. That is what anybody binding Ctrl+M wants,
 * and it is why the labels are Latin.
 */

const props = defineProps<{
  /** The combination as a profile stores it: `ctrl+shift+m`. */
  modelValue?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

/**
 * The rows on screen, which are not quite what is stored.
 *
 * A row with nothing chosen in it is a state of the editor rather than
 * something to keep: pressing ＋ has to put an empty select on screen, and an
 * empty select must not reach the profile as a key. Held locally for exactly
 * that reason — derived straight from the stored value, the new row was
 * filtered out on the way in and the button appeared to do nothing.
 */
const chosen = ref<string[]>(rows());

function rows(): string[] {
  const ids = parseHotkey(props.modelValue ?? '');
  return ids.length > 0 ? ids : [''];
}

/**
 * Adopts a change that came from somewhere else — a different command
 * selected, an undo — while leaving our own edits alone, empty rows included.
 */
watch(
  () => props.modelValue,
  (value) => {
    if (formatHotkey(chosen.value.filter((id) => id !== '')) !== (value ?? '')) {
      chosen.value = rows();
    }
  },
);

const full = computed(() => chosen.value.length >= MAX_HOTKEY_KEYS);

/** Offered in groups: a flat list of a hundred and thirty keys is a wall. */
const GROUPS: readonly KeyGroup[] = [
  'modifier',
  'letter',
  'digit',
  'function',
  'navigation',
  'symbol',
  'numpad',
  'media',
];

const grouped = computed(() =>
  GROUPS.map((group) => ({
    group,
    keys: KEYBOARD_KEYS.filter((key: KeyboardKey) => key.group === group),
  })).filter((entry) => entry.keys.length > 0),
);

/** What the combination reads as, which is the thing worth checking at a glance. */
const preview = computed(() =>
  chosen.value
    .filter((id) => id !== '')
    .map((id) => say(keyboardKey(id)?.label) || id)
    .join(' + '),
);

function commit(ids: string[]): void {
  chosen.value = ids;
  emit('update:modelValue', formatHotkey(ids.filter((id) => id !== '')));
}

function setAt(index: number, id: string): void {
  commit(chosen.value.map((each, at) => (at === index ? id : each)));
}

function add(): void {
  if (full.value) return;
  commit([...chosen.value, '']);
}

/**
 * Takes the last key off, which is the only removal offered.
 *
 * A cross beside every list made a destructive button the neighbour of every
 * choice, and which key it removed depended on which one it sat next to. One
 * cross at the end removes what was added last, which is what undoing a
 * combination means.
 */
function removeLast(): void {
  const left = chosen.value.slice(0, -1);
  commit(left.length > 0 ? left : ['']);
}
</script>

<template>
  <!-- Spans rather than divs: the parameter form puts this inside a <label>,
       which may only hold phrasing content. A <div> there closes the label
       early in some parsers, and a field that sometimes loses its label is a
       worse bug than it looks. -->
  <span class="hotkey">
    <span v-for="(id, index) in chosen" :key="index" class="slot">
      <span v-if="index > 0" class="plus" aria-hidden="true">+</span>

      <!-- Titled with what is chosen: the box is narrow enough that "Right Alt
           (AltGr)" does not fit, and the list is where the full name is read. -->
      <select
        :value="id"
        :title="say(keyboardKey(id)?.label)"
        @change="setAt(index, ($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ t('editor.choose') }}</option>
        <optgroup
          v-for="entry in grouped"
          :key="entry.group"
          :label="t(`editor.keyGroup.${entry.group}`)"
        >
          <option v-for="key in entry.keys" :key="key.id" :value="key.id">
            {{ say(key.label) }}
          </option>
        </optgroup>
      </select>
    </span>

    <!-- One cross, at the end, taking the last key off. A cross per row put a
         destructive button between every two lists, where the thing being
         removed was whichever one it happened to sit beside. It comes before
         ＋ so the button that grows the row is the last thing in it. -->
    <button
      v-if="chosen.length > 1"
      type="button"
      class="drop"
      :title="t('editor.hotkeyRemove')"
      :aria-label="t('editor.hotkeyRemove')"
      @click="removeLast"
    >
      ✕
    </button>

    <button
      type="button"
      class="add"
      :disabled="full"
      :title="full ? t('editor.hotkeyFull', { max: MAX_HOTKEY_KEYS }) : t('editor.hotkeyAdd')"
      @click="add"
    >
      ＋
    </button>

    <span class="muted small preview">
      <template v-if="preview">{{ preview }}</template>
      <template v-else>{{ t('editor.hotkeyEmpty') }}</template>
    </span>
  </span>
</template>

<style scoped>
.hotkey {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.slot {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Sixty pixels of text and twenty for the arrow. Most answers are a letter or
   `Ctrl`; the long ones are read in the list, and from the title on hover. */
.slot select {
  width: 80px;
  min-width: 0;
  padding-right: 4px;
}

.plus {
  color: var(--text-muted);
}

.drop,
.add {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  line-height: 1;
}

.add:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Its own line under the row, which is where a summary belongs however the
   row happens to wrap. */
.preview {
  flex-basis: 100%;
}
</style>
