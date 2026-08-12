<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { IconBinding, IconParam, LocalizedText, VariableDeclaration } from '@easydeck/core';
import { iconPaletteProblem, iconParamsProblem, readIconParams, svgTextOf } from '@easydeck/engine/icons';

import ColorPicker from './ColorPicker.vue';
import VariableSelect from './VariableSelect.vue';

/**
 * Wiring up an icon that answers to a variable.
 *
 * Only appears where the picture asks for it: an icon declares its parameters
 * in its own metadata, and an ordinary one declares none, so most keys never
 * see this window. It is for whoever builds presets and plugins — a needle
 * that swings with the processor is not something a person assembles by
 * accident.
 *
 * Every parameter is fed one of two ways. A fixed value is a decision made
 * once — the colour of this particular gauge. A variable makes the picture
 * follow something: a number is mapped from the variable's range onto the
 * one the icon declared, and anything else is looked up in a small table,
 * which is how a flag or an enum picks between colours.
 */

const props = defineProps<{
  /** The picture, as the profile stores it. */
  source: string;
  bindings?: Readonly<Record<string, IconBinding>>;
  declarations: readonly VariableDeclaration[];
  /** Live values, so the row can show what the variable says right now. */
  values: Readonly<Record<string, string | number | boolean>>;
  /** Asks a plugin what may go in a family's argument; see VariableSelect. */
  loadOptions?: (
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
}>();

const emit = defineEmits<{
  update: [bindings: Record<string, IconBinding>];
  close: [];
}>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

const svg = computed(() => svgTextOf(props.source) ?? '');
const params = computed<IconParam[]>(() => readIconParams(svg.value));

/**
 * What is wrong with the picture's own declaration, if anything.
 *
 * Shown rather than swallowed: reading is forgiving so an icon never fails to
 * load, and the price of that is a silence somebody has to be told about.
 *
 * The palette is asked too, even though its swatches live elsewhere. It shares
 * this block, and a name claimed by both sides is a complaint about the block
 * rather than about either half of it — reported here because this is the one
 * window an icon's own declaration is ever discussed in.
 */
const problem = computed(() => iconParamsProblem(svg.value) ?? iconPaletteProblem(svg.value));

/** Names offered for binding, the user's own and the plugins' alike. */
const variableNames = computed(() => {
  const names = new Set([
    ...props.declarations.map((variable) => variable.name),
    ...Object.keys(props.values),
  ]);
  return [...names].sort();
});

const bindingOf = (param: IconParam): IconBinding | undefined => props.bindings?.[param.name];

const isVariable = (param: IconParam): boolean => typeof bindingOf(param) === 'object';

const variableOf = (param: IconParam): string => {
  const binding = bindingOf(param);
  return typeof binding === 'object' ? binding.variable : '';
};

const rangeOf = (param: IconParam, end: 'from' | 'to'): string => {
  const binding = bindingOf(param);
  if (typeof binding !== 'object') return '';
  const value = binding[end];
  return value === undefined ? '' : String(value);
};

/** The lookup table, as the rows a table editor shows. */
const mapOf = (param: IconParam): [string, string][] => {
  const binding = bindingOf(param);
  if (typeof binding !== 'object' || !binding.map) return [];
  return Object.entries(binding.map);
};

const constantOf = (param: IconParam): string => {
  const binding = bindingOf(param);
  if (binding === undefined) return param.default === undefined ? '' : String(param.default);
  return typeof binding === 'object' ? '' : String(binding);
};

function patch(name: string, binding: IconBinding | undefined): void {
  const next = { ...(props.bindings ?? {}) };
  if (binding === undefined) delete next[name];
  else next[name] = binding;

  emit('update', next);
}

/** Switching how a parameter is fed, which throws the other way's settings away. */
function setKind(param: IconParam, kind: 'fixed' | 'variable'): void {
  if (kind === 'fixed') {
    patch(param.name, param.default === undefined ? '' : String(param.default));
    return;
  }

  const first = variableNames.value[0] ?? '';
  patch(
    param.name,
    param.type === 'color' || param.type === 'text'
      ? { variable: first, map: {} }
      : { variable: first, from: 0, to: 100 },
  );
}

function setVariable(param: IconParam, variable: string): void {
  const binding = bindingOf(param);
  if (typeof binding !== 'object') return;
  patch(param.name, { ...binding, variable });
}

function setRange(param: IconParam, end: 'from' | 'to', raw: string): void {
  const binding = bindingOf(param);
  if (typeof binding !== 'object') return;

  const next = { ...binding };
  if (raw === '') delete next[end];
  else next[end] = Number(raw);

  patch(param.name, next);
}

function setMapEntry(param: IconParam, at: number, part: 'when' | 'then', raw: string): void {
  const binding = bindingOf(param);
  if (typeof binding !== 'object') return;

  const rows = mapOf(param);
  const row = rows[at];
  if (!row) return;

  rows[at] = part === 'when' ? [raw, row[1]] : [row[0], raw];
  patch(param.name, { ...binding, map: Object.fromEntries(rows) });
}

function addMapEntry(param: IconParam): void {
  const binding = bindingOf(param);
  if (typeof binding !== 'object') return;

  const rows = mapOf(param);
  // Seeded with what the variable says right now: the common case is "this
  // value, that colour", and the value is usually already on screen.
  const current = String(props.values[variableOf(param)] ?? '');
  rows.push([rows.some(([when]) => when === current) ? '' : current, String(param.default ?? '')]);

  patch(param.name, { ...binding, map: Object.fromEntries(rows) });
}

function removeMapEntry(param: IconParam, at: number): void {
  const binding = bindingOf(param);
  if (typeof binding !== 'object') return;

  const rows = mapOf(param).filter((_, index) => index !== at);
  patch(param.name, { ...binding, map: Object.fromEntries(rows) });
}

/** Held locally so a repaint cannot rewrite a half-typed number. */
const typing = ref<Record<string, string>>({});

function typed(key: string, stored: string): string {
  return typing.value[key] ?? stored;
}

function type(key: string, raw: string, commit: (value: string) => void): void {
  typing.value = { ...typing.value, [key]: raw };
  commit(raw);
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2>{{ t('editor.iconParams') }}</h2>
        <button type="button" class="close" :aria-label="t('prompt.cancel')" @click="emit('close')">
          ✕
        </button>
      </header>

      <p class="muted desc">{{ t('editor.iconParamsHint') }}</p>

      <p v-if="problem" class="problem">
        {{ t('editor.iconBadMetadata') }}
        <code>{{ problem }}</code>
      </p>

      <section v-for="param in params" :key="param.name" class="param">
        <header class="param-head">
          <strong>{{ say(param.label) || param.name }}</strong>
          <span class="muted small">
            {{ param.name }}<template v-if="param.unit"> · {{ param.unit }}</template>
          </span>
        </header>

        <p v-if="say(param.description)" class="muted small">{{ say(param.description) }}</p>

        <div class="row">
          <select
            :value="isVariable(param) ? 'variable' : 'fixed'"
            @change="setKind(param, ($event.target as HTMLSelectElement).value as 'fixed' | 'variable')"
          >
            <option value="fixed">{{ t('editor.iconFixed') }}</option>
            <option value="variable">{{ t('editor.iconFromVariable') }}</option>
          </select>

          <!-- A colour gets a swatch, a number a spinner, anything else a box:
               the same controls these values have everywhere else. -->
          <ColorPicker
            v-if="!isVariable(param) && param.type === 'color'"
            :model-value="constantOf(param)"
            fallback="#ffffff"
            @update:model-value="patch(param.name, $event)"
          />
          <input
            v-else-if="!isVariable(param)"
            :type="param.type === 'text' ? 'text' : 'number'"
            :value="typed(param.name, constantOf(param))"
            @input="
              type(param.name, ($event.target as HTMLInputElement).value, (value) =>
                patch(param.name, param.type === 'text' ? value : Number(value)))
            "
          />

          <VariableSelect
            v-else
            :model-value="variableOf(param)"
            :values="values"
            :declarations="declarations"
            :load-options="loadOptions"
            @update:model-value="setVariable(param, $event)"
          />
        </div>

        <!-- A number is mapped: this much of the variable is that much of the
             picture, and the icon already said what its own ends mean. -->
        <div v-if="isVariable(param) && param.type !== 'color' && param.type !== 'text'" class="row">
          <span class="muted small">{{ t('editor.iconRange') }}</span>
          <input
            type="number"
            :placeholder="t('editor.whenFrom')"
            :value="typed(`${param.name}:from`, rangeOf(param, 'from'))"
            @input="
              type(`${param.name}:from`, ($event.target as HTMLInputElement).value, (value) =>
                setRange(param, 'from', value))
            "
          />
          <input
            type="number"
            :placeholder="t('editor.whenTo')"
            :value="typed(`${param.name}:to`, rangeOf(param, 'to'))"
            @input="
              type(`${param.name}:to`, ($event.target as HTMLInputElement).value, (value) =>
                setRange(param, 'to', value))
            "
          />
          <span class="muted small">→ {{ param.from ?? 0 }}…{{ param.to ?? 1 }}{{ param.unit ?? '' }}</span>
        </div>

        <!-- Anything else is looked up: a flag or an enum picks between
             values, and there is nothing to interpolate between. -->
        <div v-else-if="isVariable(param)" class="map">
          <div v-for="(entry, at) in mapOf(param)" :key="at" class="row">
            <input
              type="text"
              :placeholder="t('editor.iconWhenValue')"
              :value="entry[0]"
              @input="setMapEntry(param, at, 'when', ($event.target as HTMLInputElement).value)"
            />
            <span class="muted small">→</span>
            <ColorPicker
              v-if="param.type === 'color'"
              :model-value="entry[1]"
              fallback="#ffffff"
              @update:model-value="setMapEntry(param, at, 'then', $event)"
            />
            <input
              v-else
              type="text"
              :value="entry[1]"
              @input="setMapEntry(param, at, 'then', ($event.target as HTMLInputElement).value)"
            />
            <button type="button" class="drop" @click="removeMapEntry(param, at)">✕</button>
          </div>

          <button type="button" class="add" @click="addMapEntry(param)">
            {{ t('editor.iconAddCase') }}
          </button>

          <p class="muted small">
            {{ t('editor.iconNow') }}: {{ values[variableOf(param)] ?? '—' }}
          </p>
        </div>
      </section>

      <p v-if="params.length === 0" class="muted desc">{{ t('editor.iconNoParams') }}</p>

      <footer>
        <button type="button" class="primary" @click="emit('close')">{{ t('plugins.close') }}</button>
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
  z-index: 45;
}

.dialog {
  width: min(520px, 94vw);
  max-height: 88vh;
  overflow-y: auto;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 18px 20px 16px;
}

header {
  display: flex;
  align-items: center;
  gap: 10px;
}

h2 {
  flex: 1;
  margin: 0;
  font-size: 16px;
}

.close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  padding: 2px 6px;
}

.desc {
  font-size: 12px;
  margin: 4px 0 0;
}

.problem {
  margin: 10px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  background: var(--surface-2);
  border: 1px solid #d4544a;
}

.problem code {
  display: block;
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-word;
}

.small {
  font-size: 11px;
}

.param {
  margin: 16px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--border);
}

.param-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
}

.row > input:not([type='color']),
.row > select {
  flex: 1;
  min-width: 0;
}

input[type='color'].swatch {
  flex: none;
  width: 34px;
  padding: 2px;
}

.map {
  margin: 4px 0 0;
}

.drop,
.add {
  flex: none;
  font-size: 11px;
  padding: 3px 8px;
}

.add {
  margin: 8px 0 0;
}

footer {
  display: flex;
  justify-content: flex-end;
  margin: 18px 0 0;
}
</style>
