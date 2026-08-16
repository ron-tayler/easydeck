<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LocalizedText, StorePlugin } from '@easydeck/core';

import { useDeck } from '../composables/useDeck.js';
import { confirmAction } from '../composables/useConfirm.js';

/**
 * The shelf: what can be installed, and what it looks like.
 *
 * A panel inside the settings window rather than a window of its own, beside
 * the list of what is installed — the two are the same question asked from
 * either end, and a store you had to leave the settings to find would be a
 * store nobody found.
 *
 * It reads the deck itself rather than taking its list as a property. The
 * state is entirely its own — a list of downloads and one picture cache —
 * and nothing else in the window has any use for it; KioskDeck does the same
 * for the same reason.
 *
 * Pictures are fetched one at a time and only when they are about to be
 * shown: a cover is small and a screenshot is not, and the list is the one
 * view that must open at once.
 */

const { t, locale } = useI18n();
const deck = useDeck();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

const plugins = ref<readonly StorePlugin[]>([]);
const loading = ref(true);
const note = ref<string | undefined>();
/** The plugin an install or a removal is running for. */
const busy = ref<string | undefined>();

/** The plugin whose card is open, by id. Nothing means the list is showing. */
const opened = ref<string | undefined>();
const shown = computed(() => plugins.value.find((plugin) => plugin.id === opened.value));

/**
 * Pictures already fetched, by reference.
 *
 * Kept across going back and forth: the cover of a plugin somebody opened and
 * closed is the same cover its row was already showing.
 */
const images = ref<Record<string, string>>({});

async function fetchImage(pluginId: string, reference: string): Promise<void> {
  if (images.value[reference] !== undefined) return;

  const image = await deck.storeImage(pluginId, reference);
  if (image) images.value = { ...images.value, [reference]: image };
}

async function load(refresh = false): Promise<void> {
  loading.value = true;
  note.value = undefined;

  try {
    plugins.value = await deck.listStorePlugins(refresh);
  } catch (error) {
    plugins.value = [];
    note.value = (error as Error).message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

/** Covers for the rows on screen, asked for as the list arrives. */
watch(plugins, (list) => {
  for (const plugin of list) {
    if (plugin.manifest.cover) void fetchImage(plugin.id, plugin.manifest.cover);
  }
});

/** A card's screenshots, asked for when the card opens and not before. */
watch(shown, (plugin) => {
  if (!plugin) return;
  for (const shot of plugin.manifest.screenshots ?? []) void fetchImage(plugin.id, shot);
});

/**
 * What the button says, which is the whole state of a row in one word.
 *
 * The four cases are genuinely different actions: nothing there, an older
 * version there, the same version there, and one this build cannot run.
 */
function stateOf(plugin: StorePlugin): 'install' | 'update' | 'installed' | 'incompatible' {
  if (!plugin.compatible) return 'incompatible';
  if (plugin.installedVersion === undefined) return 'install';
  return plugin.installedVersion === plugin.version ? 'installed' : 'update';
}

async function install(plugin: StorePlugin): Promise<void> {
  const state = stateOf(plugin);
  if (state === 'incompatible' || state === 'installed') return;

  busy.value = plugin.id;
  note.value = undefined;

  try {
    // Replacing is only ever asked for where something is already there, so
    // the flag says "this is an update", not "overwrite whatever you find".
    await deck.installPlugin(plugin.id, state === 'update');
    /*
     * The list is read again rather than patched.
     *
     * What changed is which version is on disk, and that is the daemon's
     * answer to give — a window that decided for itself would be right until
     * the first install that half-succeeded.
     */
    await load();
    // Installed code only runs after a restart: an ES module cannot be
    // unloaded, and saying so beats pretending it is already live.
    note.value = t('store.restartNeeded');
  } catch (error) {
    note.value = (error as Error).message;
  } finally {
    busy.value = undefined;
  }
}

async function remove(plugin: StorePlugin): Promise<void> {
  if (!(await confirmAction('plugin-remove', t('store.remove'), t('store.removeWarning')))) return;

  busy.value = plugin.id;
  note.value = undefined;

  try {
    await deck.removePlugin(plugin.id);
    await load();
    note.value = t('store.restartNeeded');
  } catch (error) {
    note.value = (error as Error).message;
  } finally {
    busy.value = undefined;
  }
}

const size = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** An action's name, or its type when the plugin named it in no language. */
const named = (text: LocalizedText | undefined, fallback: string): string => say(text) || fallback;
</script>

<template>
  <div class="store">
    <header>
      <button v-if="opened" type="button" @click="opened = undefined">← {{ t('store.back') }}</button>
      <h3>{{ opened ? say(shown?.manifest.name) : t('store.title') }}</h3>
      <span class="spacer" />
      <button v-if="!opened" type="button" :disabled="loading" @click="load(true)">
        {{ t('store.refresh') }}
      </button>
    </header>

    <p v-if="note" class="note">{{ note }}</p>

    <!-- The shelf. -->
    <template v-if="!opened">
      <p v-if="loading" class="muted">{{ t('store.loading') }}</p>
      <p v-else-if="plugins.length === 0" class="muted empty">{{ t('store.empty') }}</p>

      <button
        v-for="plugin in plugins"
        :key="plugin.id"
        type="button"
        class="row"
        @click="opened = plugin.id"
      >
        <img
          v-if="plugin.manifest.cover && images[plugin.manifest.cover]"
          class="cover"
          :src="images[plugin.manifest.cover]"
          alt=""
        />
        <span v-else class="cover blank" />

        <span class="about">
          <span class="name">{{ say(plugin.manifest.name) }}</span>
          <span class="muted small">
            {{ say(plugin.manifest.author) || plugin.author }} · {{ plugin.version }} ·
            {{ size(plugin.bytes) }}
          </span>
          <span class="muted small desc">{{ say(plugin.manifest.description) }}</span>
        </span>

        <span class="state" :class="stateOf(plugin)">{{ t(`store.state.${stateOf(plugin)}`) }}</span>
      </button>
    </template>

    <!-- One plugin, in full. -->
    <template v-else-if="shown">
      <div v-if="(shown.manifest.screenshots ?? []).length > 0" class="shots">
        <img
          v-for="shot in shown.manifest.screenshots ?? []"
          :key="shot"
          :src="images[shot]"
          class="shot"
          alt=""
        />
      </div>

      <p>{{ say(shown.manifest.description) }}</p>

      <dl class="facts">
        <dt>{{ t('store.author') }}</dt>
        <dd>{{ say(shown.manifest.author) || shown.author }}</dd>
        <dt>{{ t('store.version') }}</dt>
        <dd>
          {{ shown.version }}
          <span v-if="shown.installedVersion && shown.installedVersion !== shown.version" class="muted">
            ({{ t('store.installedNow', { version: shown.installedVersion }) }})
          </span>
        </dd>
        <dt>{{ t('store.size') }}</dt>
        <dd>{{ size(shown.bytes) }}</dd>
      </dl>

      <!-- What it actually does, taken from the manifest rather than from a
           description of it: these are the very actions the key editor will
           offer once it is installed. -->
      <template v-if="shown.manifest.actions.length > 0">
        <h4>{{ t('store.actions') }}</h4>
        <ul class="what">
          <li v-for="action in shown.manifest.actions" :key="action.type">
            <b>{{ named(action.label, action.type) }}</b>
            <span v-if="action.description" class="muted small">{{ say(action.description) }}</span>
          </li>
        </ul>
      </template>

      <template v-if="(shown.manifest.variables ?? []).length > 0">
        <h4>{{ t('store.variables') }}</h4>
        <ul class="what">
          <li v-for="variable in shown.manifest.variables ?? []" :key="variable.name">
            <b>{{ named(variable.label, variable.name) }}</b>
            <span class="muted small"><code>{{ variable.name }}</code></span>
          </li>
        </ul>
      </template>

      <p v-if="!shown.compatible" class="note">
        {{ t('store.incompatibleWhy', { version: shown.apiVersion }) }}
      </p>

      <footer>
        <button
          type="button"
          class="primary"
          :disabled="busy === shown.id || stateOf(shown) === 'installed' || !shown.compatible"
          @click="install(shown)"
        >
          {{ busy === shown.id ? t('store.working') : t(`store.state.${stateOf(shown)}`) }}
        </button>
        <button
          v-if="shown.installedVersion"
          type="button"
          :disabled="busy === shown.id"
          @click="remove(shown)"
        >
          {{ t('store.remove') }}
        </button>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.store {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

header {
  display: flex;
  align-items: center;
  gap: 8px;
}

h3 {
  margin: 0;
  font-size: 14px;
}

h4 {
  margin: 12px 0 4px;
  font-size: 13px;
}

.spacer {
  flex: 1;
}

.row {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 10px;
  background: var(--surface-2, #222834);
  border: 1px solid var(--border, #2c333f);
  border-radius: 8px;
  cursor: pointer;
}

.row:hover {
  border-color: var(--accent, #4c8cff);
}

.cover {
  width: 96px;
  height: 54px;
  object-fit: cover;
  border-radius: 5px;
  flex: none;
}

.cover.blank {
  background: var(--border, #2c333f);
}

.about {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.name {
  font-weight: 600;
}

.desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.state {
  flex: none;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--border, #2c333f);
}

.state.install {
  background: #2f6f4f;
}

.state.update {
  background: #6f5a2f;
}

.state.incompatible {
  background: #6f3535;
}

.shots {
  display: flex;
  gap: 8px;
  overflow-x: auto;
}

.shot {
  height: 180px;
  border-radius: 6px;
}

.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 4px 0;
}

dt {
  color: var(--muted, #8b95a6);
}

dd {
  margin: 0;
}

.what {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.what li {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.note {
  padding: 8px 10px;
  border-radius: 6px;
  background: #4a2a2a;
  margin: 0;
}

.empty {
  padding: 24px 0;
  text-align: center;
}

footer {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
</style>
