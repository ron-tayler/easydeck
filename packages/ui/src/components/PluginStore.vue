<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LocalizedText, StorePlugin } from '@easydeck/core';

/**
 * The shelf: what can be installed, and what it looks like.
 *
 * Two views in one window rather than two windows, because choosing a plugin
 * is looking at a list and then at one of them — and going back is how that
 * ends more often than installing does.
 *
 * Pictures are fetched one at a time and only when they are about to be
 * shown. A cover is small and a screenshot is not, and the list is the one
 * screen that must open at once; the card's pictures are asked for when the
 * card opens, which is the moment somebody decided to wait.
 */

const props = defineProps<{
  plugins: readonly StorePlugin[];
  loading?: boolean;
  /** What went wrong last, if anything did. */
  note?: string;
  busy?: string;
  loadImage: (pluginId: string, reference: string) => Promise<string | undefined>;
}>();

const emit = defineEmits<{
  install: [pluginId: string, replace: boolean];
  remove: [pluginId: string];
  refresh: [];
  close: [];
}>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

/** The plugin whose card is open, by id. Nothing means the list is showing. */
const opened = ref<string | undefined>();

const shown = computed(() => props.plugins.find((plugin) => plugin.id === opened.value));

/**
 * Pictures already fetched, by reference.
 *
 * Kept across going back and forth: the cover of a plugin somebody opened and
 * closed is the same cover its row was already showing.
 */
const images = ref<Record<string, string>>({});

async function fetchImage(pluginId: string, reference: string): Promise<void> {
  if (images.value[reference] !== undefined) return;

  const image = await props.loadImage(pluginId, reference);
  if (image) images.value = { ...images.value, [reference]: image };
}

/** Covers for the rows on screen, asked for as the list arrives. */
watch(
  () => props.plugins,
  (plugins) => {
    for (const plugin of plugins) {
      if (plugin.manifest.cover) void fetchImage(plugin.id, plugin.manifest.cover);
    }
  },
  { immediate: true },
);

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

function actOn(plugin: StorePlugin): void {
  const state = stateOf(plugin);
  if (state === 'incompatible' || state === 'installed') return;

  // Replacing is only ever asked for where something is already there, so the
  // flag says "this is an update", not "overwrite whatever you find".
  emit('install', plugin.id, state === 'update');
}

const size = (bytes: number): string => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** An action's name, or its type when the plugin named it in no language. */
const named = (text: LocalizedText | undefined, fallback: string): string =>
  say(text) || fallback;
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <section class="store" role="dialog" aria-modal="true">
      <header>
        <button v-if="opened" type="button" class="back" @click="opened = undefined">
          ← {{ t('store.back') }}
        </button>
        <h2>{{ opened ? say(shown?.manifest.name) : t('store.title') }}</h2>

        <span class="spacer" />
        <button v-if="!opened" type="button" :disabled="loading" @click="emit('refresh')">
          {{ t('store.refresh') }}
        </button>
        <button type="button" @click="emit('close')">{{ t('store.close') }}</button>
      </header>

      <p v-if="note" class="note">{{ note }}</p>

      <!-- The shelf. -->
      <div v-if="!opened" class="list">
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
            <span class="muted desc">{{ say(plugin.manifest.description) }}</span>
          </span>

          <span class="state" :class="stateOf(plugin)">{{ t(`store.state.${stateOf(plugin)}`) }}</span>
        </button>
      </div>

      <!-- One plugin, in full. -->
      <div v-else-if="shown" class="card">
        <div class="shots" v-if="(shown.manifest.screenshots ?? []).length > 0">
          <img
            v-for="shot in shown.manifest.screenshots ?? []"
            :key="shot"
            :src="images[shot]"
            class="shot"
            alt=""
          />
        </div>

        <p class="desc">{{ say(shown.manifest.description) }}</p>

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
             description of the manifest: these are the very actions the key
             editor will offer once it is installed. -->
        <h3 v-if="shown.manifest.actions.length > 0">{{ t('store.actions') }}</h3>
        <ul v-if="shown.manifest.actions.length > 0" class="actions">
          <li v-for="action in shown.manifest.actions" :key="action.type">
            <b>{{ named(action.label, action.type) }}</b>
            <span v-if="action.description" class="muted small">{{ say(action.description) }}</span>
          </li>
        </ul>

        <h3 v-if="(shown.manifest.variables ?? []).length > 0">{{ t('store.variables') }}</h3>
        <ul v-if="(shown.manifest.variables ?? []).length > 0" class="actions">
          <li v-for="variable in shown.manifest.variables ?? []" :key="variable.name">
            <b>{{ named(variable.label, variable.name) }}</b>
            <span class="muted small"><code>{{ variable.name }}</code></span>
          </li>
        </ul>

        <p v-if="!shown.compatible" class="note">
          {{ t('store.state.incompatible') }} — {{ t('store.incompatibleWhy', { version: shown.apiVersion }) }}
        </p>

        <footer>
          <button
            type="button"
            class="primary"
            :disabled="busy === shown.id || stateOf(shown) === 'installed' || !shown.compatible"
            @click="actOn(shown)"
          >
            {{ busy === shown.id ? t('store.working') : t(`store.state.${stateOf(shown)}`) }}
          </button>
          <button
            v-if="shown.installedVersion"
            type="button"
            :disabled="busy === shown.id"
            @click="emit('remove', shown.id)"
          >
            {{ t('store.remove') }}
          </button>
        </footer>
      </div>
    </section>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 55%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}

.store {
  background: var(--panel, #1b1f27);
  border: 1px solid var(--line, #2c333f);
  border-radius: 10px;
  width: min(760px, 92vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line, #2c333f);
}

h2 {
  margin: 0;
  font-size: 15px;
}

.spacer {
  flex: 1;
}

.list,
.card {
  overflow: auto;
  padding: 12px 14px;
}

.row {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 10px;
  margin-bottom: 8px;
  background: var(--raised, #222834);
  border: 1px solid var(--line, #2c333f);
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
  background: var(--line, #2c333f);
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
  background: var(--line, #2c333f);
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
  margin-bottom: 12px;
}

.shot {
  height: 180px;
  border-radius: 6px;
}

.facts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 10px 0;
}

dt {
  color: var(--muted, #8b95a6);
}

dd {
  margin: 0;
}

h3 {
  font-size: 13px;
  margin: 14px 0 6px;
}

.actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.actions li {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.note {
  margin: 10px 14px 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #4a2a2a;
}

.empty {
  padding: 24px 0;
  text-align: center;
}

.muted {
  color: var(--muted, #8b95a6);
}

.small {
  font-size: 12px;
}

footer {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>
