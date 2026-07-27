<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { DeckState, LocalizedText, PluginManifest } from '@easydeck/core';

import { SUPPORTED_LOCALES, setLocale } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { THEMES, useTheme } from '../composables/useTheme.js';
import type { Theme } from '../composables/useTheme.js';

const props = defineProps<{
  state?: DeckState;
  plugins: readonly PluginManifest[];
  transportKind: 'ipc' | 'websocket';
}>();

const emit = defineEmits<{ close: []; openFolder: [action: string] }>();

const { t, locale } = useI18n();
const { theme, setTheme } = useTheme();

const SECTIONS = ['system', 'plugins', 'core', 'deck', 'about'] as const;
type Section = (typeof SECTIONS)[number];
const section = ref<Section>('system');

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

const actionCount = computed(() =>
  props.plugins.reduce((total, plugin) => total + plugin.actions.length, 0),
);
</script>

<template>
  <!-- Closing on the backdrop and on Escape, because a settings window that
       traps you is worse than one you can dismiss by accident. -->
  <div class="backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <nav>
        <button
          v-for="name in SECTIONS"
          :key="name"
          type="button"
          class="tab"
          :class="{ current: section === name }"
          @click="section = name"
        >
          {{ t(`settings.${name}.title`) }}
        </button>
      </nav>

      <div class="body">
        <button type="button" class="close" :aria-label="t('settings.close')" @click="emit('close')">
          ✕
        </button>

        <section v-if="section === 'system'">
          <h2>{{ t('settings.system.title') }}</h2>

          <label class="row">
            <span>{{ t('settings.system.language') }}</span>
            <select
              :value="locale"
              @change="setLocale(($event.target as HTMLSelectElement).value as Locale)"
            >
              <option v-for="code in SUPPORTED_LOCALES" :key="code" :value="code">
                {{ t(`settings.system.languages.${code}`) }}
              </option>
            </select>
          </label>

          <label class="row">
            <span>{{ t('settings.system.theme') }}</span>
            <select
              :value="theme"
              @change="setTheme(($event.target as HTMLSelectElement).value as Theme)"
            >
              <option v-for="name in THEMES" :key="name" :value="name">
                {{ t(`settings.system.themes.${name}`) }}
              </option>
            </select>
          </label>

          <label class="row disabled">
            <span>
              {{ t('settings.system.autostart') }}
              <em>{{ t('settings.soon') }}</em>
            </span>
            <input type="checkbox" disabled />
          </label>
        </section>

        <section v-else-if="section === 'plugins'">
          <h2>{{ t('settings.plugins.title') }}</h2>
          <p class="muted">{{ t('settings.plugins.summary', { count: actionCount }) }}</p>

          <ul class="list">
            <li v-for="plugin in plugins" :key="plugin.id">
              <div>
                <strong>{{ say(plugin.name) }}</strong>
                <span class="muted"> · {{ plugin.id }} · v{{ plugin.version }}</span>
                <p v-if="plugin.description" class="muted small">{{ say(plugin.description) }}</p>
              </div>
              <span class="muted small">{{ plugin.actions.length }}</span>
            </li>
          </ul>

          <button type="button" @click="emit('openFolder', 'easydeck.open-plugins-folder')">
            {{ t('settings.plugins.openFolder') }}
          </button>
        </section>

        <section v-else-if="section === 'core'">
          <h2>{{ t('settings.core.title') }}</h2>
          <p class="muted">{{ t('settings.core.explanation') }}</p>

          <dl>
            <dt>{{ t('settings.core.transport') }}</dt>
            <dd>{{ transportKind === 'ipc' ? t('status.transportIpc') : t('status.transportWebsocket') }}</dd>
            <dt>{{ t('settings.core.protocol') }}</dt>
            <dd>{{ state?.protocolVersion ?? '—' }}</dd>
          </dl>
        </section>

        <section v-else-if="section === 'deck'">
          <h2>{{ t('settings.deck.title') }}</h2>

          <dl v-if="state">
            <dt>{{ t('status.device') }}</dt>
            <dd>{{ state.device.model }}</dd>
            <dt>{{ t('settings.deck.layout') }}</dt>
            <dd>{{ state.device.rows }} × {{ state.device.cols }}</dd>
            <dt>{{ t('settings.deck.keySize') }}</dt>
            <dd>{{ state.device.keyWidth }} × {{ state.device.keyHeight }}</dd>
            <dt>{{ t('settings.deck.brightness') }}</dt>
            <dd>{{ state.brightness }}%</dd>
          </dl>
          <p v-else class="muted">{{ t('status.noDeck') }}</p>
        </section>

        <section v-else>
          <h2>{{ t('settings.about.title') }}</h2>
          <p>{{ t('settings.about.text') }}</p>
          <button type="button" @click="emit('openFolder', 'easydeck.open-config-folder')">
            {{ t('settings.about.openConfig') }}
          </button>
        </section>
      </div>
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
  z-index: 10;
}

.dialog {
  display: grid;
  grid-template-columns: 168px minmax(0, 1fr);
  width: min(760px, 92vw);
  height: min(520px, 88vh);
  background: var(--surface-0);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 18px 48px var(--shadow);
  overflow: hidden;
}

nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 8px;
  background: var(--surface-1);
  border-right: 1px solid var(--border);
}

.tab {
  background: none;
  border: 1px solid transparent;
  text-align: left;
  font-size: 13px;
  padding: 7px 10px;
}

.tab:hover:not(:disabled) {
  background: var(--surface-2);
}

.tab.current {
  background: var(--accent-soft);
  color: var(--accent);
}

.body {
  position: relative;
  padding: 18px 22px;
  overflow-y: auto;
}

.close {
  position: absolute;
  top: 12px;
  right: 14px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  padding: 4px 6px;
}

h2 {
  margin: 0 0 14px;
  font-size: 15px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}

.row.disabled {
  opacity: 0.6;
}

.row em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 6px;
}

.list {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 11px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 13px;
}

.small {
  font-size: 11px;
}

.list p {
  margin: 3px 0 0;
}

dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 18px;
  margin: 0;
  font-size: 13px;
}

dt {
  color: var(--text-muted);
}

dd {
  margin: 0;
}
</style>
