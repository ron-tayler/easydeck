<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { VariableDeclaration, VariableValue } from '@easydeck/core';

import {
  allRows,
  groupVariables,
  usePluginTitle,
  type VariableGroup,
  type VariableRow,
} from '../composables/useVariableGroups.js';

/**
 * The list of variables, as a menu that opens sideways.
 *
 * A plugin publishes tens of variables and a profile may have several plugins,
 * so the flat alphabetical list this replaces was a hundred rows deep with no
 * landmark in it but the prefix on each name. Here the first level is who owns
 * them and the second is theirs — the shape of a context menu, because that is
 * the shape people already know for "a choice inside a choice".
 *
 * Floated to the body and positioned in viewport coordinates: every field this
 * opens from lives inside a dialog column that scrolls and clips, and a list
 * that opens sideways has nowhere to go inside one.
 */

const props = defineProps<{
  /** Where to open: the bottom-left corner of whatever was clicked. */
  x: number;
  y: number;
  values: Readonly<Record<string, VariableValue>>;
  declarations: readonly VariableDeclaration[];
  /** `declared` offers families rather than each of their live keys. */
  mode?: 'all' | 'declared';
  /** The name currently held, marked in the list. */
  chosen?: string;
  /** An entry above everything that answers "none", where that is allowed. */
  clearLabel?: string;
}>();

const emit = defineEmits<{ pick: [name: string]; close: [] }>();

const { t, locale } = useI18n();
const pluginTitle = usePluginTitle();

const menu = ref<HTMLElement>();
const filter = ref<HTMLInputElement>();
const query = ref('');
/** Which group's list is showing; the first one until the pointer says else. */
const openGroup = ref<string>();

const groups = computed<VariableGroup[]>(() =>
  groupVariables({
    values: props.values,
    declarations: props.declarations,
    profileTitle: t('variables.profileGroup'),
    pluginTitle,
    ...(props.mode ? { mode: props.mode } : {}),
  }),
);

/** Groups with nothing in them are not worth a row to hover over. */
const shown = computed(() => groups.value.filter((group) => group.rows.length > 0));

const current = computed(() => shown.value.find((group) => group.id === openGroup.value));

const say = (row: VariableRow): string =>
  row.label ? (row.label[locale.value] ?? row.label.en ?? row.name) : '';

/**
 * A search runs across every group at once.
 *
 * Two levels are how you *browse*; nobody wants to guess which plugin owns
 * `gpu-load` in order to find it. Once anything is typed the structure gets
 * out of the way and the owner becomes a badge on the row instead.
 */
const matches = computed<VariableRow[]>(() => {
  const needle = query.value.trim().toLowerCase();
  if (needle === '') return [];

  return allRows(shown.value)
    .filter((row) => row.name.toLowerCase().includes(needle) || say(row).toLowerCase().includes(needle))
    .slice(0, 60);
});

/**
 * What was typed, offered as itself when nothing matches it.
 *
 * Setting up an OBS key while OBS is closed is the ordinary case, not the
 * exception, so a name the deck has never heard of has to remain typeable —
 * this is the free text box the old field was, kept as the last resort rather
 * than as the only option.
 */
const typed = computed(() => {
  const raw = query.value.trim();
  if (raw === '') return undefined;
  return matches.value.some((row) => row.name === raw) ? undefined : raw;
});

const position = ref({ x: props.x, y: props.y });
const flipped = ref(false);

/** Matches the width the stylesheet gives the second level. */
const SUB_WIDTH = 235;

onMounted(async () => {
  openGroup.value = groupHolding(props.chosen) ?? shown.value[0]?.id;
  filter.value?.focus();

  await nextTick();
  const element = menu.value;
  const room = window.innerWidth || document.documentElement.clientWidth;
  const tall = window.innerHeight || document.documentElement.clientHeight;

  /*
   * Nothing is moved unless the window can say how big it is.
   *
   * A viewport reporting zero — which happens while a page is still being laid
   * out — used to mean "everything is off the right edge", and the menu put
   * itself at the far left with its second level at a negative coordinate,
   * entirely off screen. Staying where it was asked to open is the harmless
   * answer to not knowing.
   */
  if (element && room > 0 && tall > 0) {
    const { width, height } = element.getBoundingClientRect();
    position.value = {
      x: Math.max(8, Math.min(props.x, room - width - 8)),
      y: Math.max(8, Math.min(props.y, tall - height - 8)),
    };
    // The second level opens to the right unless the right is where the edge
    // of the window is, which is where a menu near a docked panel opens.
    flipped.value = position.value.x + width + SUB_WIDTH > room;
  }

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
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
  }
}

/** Enter takes the one match, or the name as typed when there is none. */
function onEnter(): void {
  const only = matches.value.length === 1 ? matches.value[0] : undefined;
  if (only) choose(only.name);
  else if (typed.value) choose(typed.value);
}

/** The group a name is in, so reopening lands where the answer already is. */
function groupHolding(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return shown.value.find((group) => group.rows.some((row) => row.name === name))?.id;
}

watch(query, () => {
  if (query.value === '') openGroup.value = groupHolding(props.chosen) ?? shown.value[0]?.id;
});

function choose(name: string): void {
  emit('pick', name);
  emit('close');
}

const style = computed(() => ({ left: `${position.value.x}px`, top: `${position.value.y}px` }));
</script>

<template>
  <Teleport to="body">
    <div ref="menu" class="menu" :style="style" role="menu">
      <input
        ref="filter"
        v-model="query"
        type="text"
        class="filter"
        :placeholder="t('variables.search')"
        @keydown.enter.prevent="onEnter"
      />

      <button v-if="clearLabel && !query" type="button" class="row clear" @click="choose('')">
        {{ clearLabel }}
      </button>

      <!-- Browsing: owners first, theirs to the side. -->
      <div v-if="!query" class="groups">
        <button
          v-for="group in shown"
          :key="group.id"
          type="button"
          class="row group"
          :class="{ current: group.id === openGroup }"
          @mouseenter="openGroup = group.id"
          @focus="openGroup = group.id"
          @click="openGroup = group.id"
        >
          <span class="title">{{ group.title }}</span>
          <span class="count">{{ group.rows.length }}</span>
          <span class="chevron" aria-hidden="true">›</span>
        </button>

        <div v-if="current" class="sub" :class="{ flipped }">
          <button
            v-for="row in current.rows"
            :key="row.name"
            type="button"
            class="row item"
            :class="{ picked: row.name === chosen }"
            @click="choose(row.name)"
          >
            <code>{{ row.name }}<template v-if="row.family">(…)</template></code>
            <!-- The value is the point: it is how you tell `viewers` from
                 `viewersTotal` without leaving the field you are filling in. -->
            <span class="value">{{ row.family ? t(`variables.types.${row.type}`) : row.value }}</span>
          </button>
        </div>
      </div>

      <!-- Searching: one flat list, the owner reduced to a badge. -->
      <div v-else class="flat">
        <button
          v-for="row in matches"
          :key="row.name"
          type="button"
          class="row item"
          :class="{ picked: row.name === chosen }"
          @click="choose(row.name)"
        >
          <code>{{ row.name }}<template v-if="row.family">(…)</template></code>
          <span v-if="row.pluginId" class="owner">{{ pluginTitle(row.pluginId) }}</span>
          <span class="value">{{ row.family ? t(`variables.types.${row.type}`) : row.value }}</span>
        </button>

        <button v-if="typed" type="button" class="row item as-typed" @click="choose(typed)">
          {{ t('variables.useTyped', { name: typed }) }}
        </button>

        <p v-if="matches.length === 0 && !typed" class="muted none">{{ t('variables.none') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.menu {
  position: fixed;
  z-index: 40;
  width: 260px;
  padding: 5px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 12px 32px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.filter {
  width: 100%;
  margin-bottom: 3px;
  font-size: 12px;
}

.groups {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  background: none;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  text-align: left;
}

.row:hover,
.row.current {
  background: var(--surface-2);
}

.group .title { flex: 1; min-width: 0; }
.group .count { font-size: 10px; color: var(--text-muted); }
.group .chevron { color: var(--text-muted); }

.clear { color: var(--text-muted); }

/*
 * The second level, hung off the first.
 *
 * `top: 0` rather than beside the row it belongs to: the groups are few and
 * the lists are long, so a submenu aligned to its row would spend most of its
 * height below the window.
 */
.sub {
  position: absolute;
  top: 0;
  left: calc(100% + 5px);
  width: 230px;
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 12px 32px var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sub.flipped {
  left: auto;
  right: calc(100% + 5px);
}

.flat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 320px;
  overflow-y: auto;
}

.item.picked { color: var(--accent); }

.item code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 11px;
}

.owner {
  flex: none;
  padding: 0 5px;
  border-radius: 7px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 10px;
}

.value {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-muted);
}

.as-typed { color: var(--accent); }

.none { font-size: 11px; margin: 4px 8px; }
</style>
