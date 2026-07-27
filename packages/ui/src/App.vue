<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import DeckGrid from './components/DeckGrid.vue';
import { SUPPORTED_LOCALES, setLocale } from './i18n/index.js';
import type { Locale } from './i18n/index.js';
import { useDeck } from './composables/useDeck.js';

const { t, locale } = useI18n();
const deck = useDeck();

const transportLabel = computed(() =>
  deck.transportKind === 'ipc' ? t('status.transportIpc') : t('status.transportWebsocket'),
);

const variables = computed(() => Object.entries(deck.state.value?.variables ?? {}));

function onLocale(event: Event) {
  setLocale((event.target as HTMLSelectElement).value as Locale);
}
</script>

<template>
  <div class="app">
    <header>
      <div>
        <h1>{{ t('app.title') }}</h1>
        <p class="tagline">{{ t('app.tagline') }}</p>
      </div>

      <label class="locale">
        <span class="sr-only">{{ t('language.label') }}</span>
        <select :value="locale" @change="onLocale">
          <option v-for="code in SUPPORTED_LOCALES" :key="code" :value="code">
            {{ code.toUpperCase() }}
          </option>
        </select>
      </label>
    </header>

    <p v-if="deck.lastError.value" class="error">
      {{ deck.lastError.value }}
      <button type="button" @click="deck.lastError.value = undefined">{{ t('errors.dismiss') }}</button>
    </p>

    <section class="status">
      <template v-if="deck.state.value">
        <span class="dot ok" />
        <strong>{{ deck.state.value.device.model }}</strong>
        <span class="muted">
          {{ t('status.profile') }}: {{ deck.state.value.activeProfileId ?? '—' }} ·
          {{ t('status.page') }}: {{ deck.state.value.pageId ?? '—' }} ·
          {{ transportLabel }}
        </span>
      </template>
      <template v-else-if="deck.loading.value">
        <span class="dot" />
        <span class="muted">{{ t('status.connecting') }}</span>
      </template>
      <template v-else>
        <span class="dot bad" />
        <span class="muted">{{ t('status.noDeck') }}</span>
      </template>
    </section>

    <main>
      <section class="panel">
        <h2>{{ t('deck.title') }}</h2>
        <DeckGrid
          :state="deck.state.value"
          :keys="deck.keys.value"
          :pressed-keys="deck.pressedKeys.value"
          @press="deck.pressKey"
        />
        <p class="hint">{{ t('deck.hint') }}</p>
      </section>

      <aside>
        <section>
          <h2>{{ t('profiles.title') }}</h2>
          <ul class="list">
            <li v-for="profile in deck.profiles.value" :key="profile.id">
              <span>{{ profile.name }}</span>
              <button
                v-if="profile.id !== deck.state.value?.activeProfileId"
                type="button"
                @click="deck.activateProfile(profile.id)"
              >
                {{ t('profiles.activate') }}
              </button>
              <span v-else class="badge">{{ t('profiles.active') }}</span>
            </li>
            <li v-if="deck.profiles.value.length === 0" class="muted">{{ t('profiles.none') }}</li>
          </ul>
        </section>

        <section>
          <h2>{{ t('variables.title') }}</h2>
          <ul class="list">
            <li v-for="[name, value] in variables" :key="name">
              <span class="muted">{{ name }}</span>
              <code>{{ value }}</code>
            </li>
            <li v-if="variables.length === 0" class="muted">{{ t('variables.none') }}</li>
          </ul>
        </section>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.app {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 28px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

h1 { font-size: 20px; margin: 0; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin: 0 0 10px; }

.tagline { margin: 4px 0 0; color: var(--text-muted); font-size: 13px; }

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  font-size: 14px;
}

.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-muted); flex: none; }
.dot.ok { background: #3fb950; }
.dot.bad { background: #f85149; }

main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 24px;
  align-items: start;
}

@media (max-width: 880px) {
  main { grid-template-columns: 1fr; }
}

.panel { display: flex; flex-direction: column; }
.hint { color: var(--text-muted); font-size: 12px; margin: 12px 0 0; }

aside { display: flex; flex-direction: column; gap: 22px; }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  padding: 7px 10px;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.badge { color: #3fb950; font-size: 12px; }
code { font-family: ui-monospace, monospace; font-size: 12px; }

.error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgb(248 81 73 / 12%);
  border: 1px solid rgb(248 81 73 / 35%);
  font-size: 13px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
