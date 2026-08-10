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
  /** Devices already let in, so they can be revoked from here. */
  devices?: readonly { id: string; name: string; approvedAt?: string; online?: boolean }[];
  /** Devices knocking right now, so approving has a predictable home. */
  pendingDevices?: readonly { id: string; name: string; code: string; address?: string }[];
}>();

const emit = defineEmits<{
  close: [];
  openFolder: [folder: 'config' | 'profiles' | 'plugins' | 'icons'];
  network: [patch: Record<string, unknown>];
  approveDevice: [deviceId: string];
  revokeDevice: [deviceId: string];
}>();

const { t, locale } = useI18n();
const { theme, setTheme } = useTheme();

const SECTIONS = ['system', 'network', 'plugins', 'icons', 'core', 'deck', 'about'] as const;
type Section = (typeof SECTIONS)[number];
const section = ref<Section>('system');

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

const actionCount = computed(() =>
  props.plugins.reduce((total, plugin) => total + plugin.actions.length, 0),
);

const network = computed(() => props.state?.network);

/**
 * What the user is editing, kept apart from what is running.
 *
 * Nothing is applied until Save. Network access is a feature of this program,
 * not its nature: switching it on opens a socket on someone's machine, and
 * that deserves a deliberate act rather than a checkbox that fires as it is
 * clicked.
 */
const draft = ref<{
  networkAccess: boolean;
  networkDecks: boolean;
  extensionsApi: boolean;
  port: number;
} | undefined>();

const form = computed(() => {
  const info = network.value;
  return (
    draft.value ?? {
      networkAccess: info?.networkAccess ?? false,
      networkDecks: info?.networkDecks ?? false,
      extensionsApi: info?.extensionsApi ?? false,
      port: info?.port ?? 8317,
    }
  );
});

const dirty = computed(() => {
  const info = network.value;
  if (!info || !draft.value) return false;

  return (
    draft.value.networkAccess !== info.networkAccess ||
    draft.value.networkDecks !== info.networkDecks ||
    draft.value.extensionsApi !== info.extensionsApi ||
    draft.value.port !== info.port
  );
});

const saving = ref(false);

function edit(patch: Partial<{ networkAccess: boolean; networkDecks: boolean; extensionsApi: boolean; port: number }>): void {
  draft.value = { ...form.value, ...patch };
}

async function save(): Promise<void> {
  if (!draft.value) return;

  saving.value = true;
  emit('network', { ...draft.value });

  // Cleared so the form follows the daemon again once it has answered.
  window.setTimeout(() => {
    draft.value = undefined;
    saving.value = false;
  }, 400);
}

/** Where a tablet can reach this, once there is something to reach. */
const addresses = computed(() => {
  const info = network.value;
  if (!info?.running) return [];

  return info.addresses.map((entry) => `http://${entry.address}:${info.port}/`);
});

/**
 * Only the oldest request is offered, one at a time.
 *
 * Several devices knocking at once turn the list into a row of identical
 * lines with nothing but a six-digit number to tell them apart — and the
 * number is precisely what you have to check against the screen in your hand.
 * Answering one at a time keeps the question unambiguous; the rest are
 * counted, and each answer brings up the next.
 */
const nextRequest = computed(() => props.pendingDevices?.[0]);
const alsoWaiting = computed(() => Math.max(0, (props.pendingDevices?.length ?? 0) - 1));

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

        <section v-else-if="section === 'network'">
          <h2>{{ t('settings.network.title') }}</h2>
          <p class="muted">{{ t('settings.network.explanation') }}</p>

          <template v-if="network">
            <label class="switch">
              <input
                type="checkbox"
                :checked="form.networkAccess"
                @change="edit({ networkAccess: ($event.target as HTMLInputElement).checked })"
              />
              <span>
                {{ t('settings.network.access') }}
                <small class="muted">{{ t('settings.network.accessHint') }}</small>
              </span>
            </label>

            <label class="switch">
              <input
                type="checkbox"
                :checked="form.networkDecks"
                :disabled="!form.networkAccess"
                @change="edit({ networkDecks: ($event.target as HTMLInputElement).checked })"
              />
              <span>
                {{ t('settings.network.decks') }}
                <small class="muted">{{ t('settings.network.decksHint') }}</small>
              </span>
            </label>

            <label class="switch">
              <input
                type="checkbox"
                :checked="form.extensionsApi"
                :disabled="!form.networkAccess"
                @change="edit({ extensionsApi: ($event.target as HTMLInputElement).checked })"
              />
              <span>
                {{ t('settings.network.extensions') }}
                <small class="muted">{{ t('settings.network.extensionsHint') }}</small>
              </span>
            </label>

            <label class="field">
              <span>{{ t('settings.network.port') }}</span>
              <input
                type="number"
                min="1"
                max="65535"
                :value="form.port"
                :disabled="!form.networkAccess"
                @input="edit({ port: Number(($event.target as HTMLInputElement).value) })"
              />
            </label>

            <!-- One deliberate act, rather than a socket that opens as a
                 checkbox is clicked. -->
            <button type="button" :disabled="!dirty || saving" @click="void save()">
              {{ saving ? t('settings.network.saving') : t('settings.network.save') }}
            </button>

            <p class="muted status-line">
              {{ network.running
                ? t('settings.network.runningOn', { port: network.port })
                : t('settings.network.stopped') }}
            </p>

            <template v-if="network.running">
              <h3>{{ t('settings.network.addresses') }}</h3>
              <p class="muted">{{ t('settings.network.addressesHint') }}</p>
              <ul class="addresses">
                <li v-for="url in addresses" :key="url">
                  <a :href="url" target="_blank" rel="noreferrer">{{ url }}</a>
                </li>
              </ul>
            </template>

            <h3>{{ t('settings.network.waiting') }}</h3>
            <ul v-if="nextRequest" class="clients">
              <li :key="nextRequest.id">
                <span>
                  {{ nextRequest.name }}
                  <span v-if="nextRequest.address" class="muted"> · {{ nextRequest.address }}</span>
                </span>
                <code class="code">{{ nextRequest.code }}</code>
                <button type="button" @click="emit('approveDevice', nextRequest.id)">
                  {{ t('devices.approve') }}
                </button>
                <button type="button" @click="emit('revokeDevice', nextRequest.id)">
                  {{ t('devices.reject') }}
                </button>
              </li>
            </ul>
            <p v-else class="muted">{{ t('settings.network.noWaiting') }}</p>
            <p v-if="alsoWaiting > 0" class="muted">
              {{ t('settings.network.alsoWaiting', { count: alsoWaiting }) }}
            </p>

            <h3>{{ t('settings.network.clients') }}</h3>
            <ul v-if="devices && devices.length > 0" class="clients">
              <li v-for="device in devices" :key="device.id">
                <span>
                  {{ device.name }}
                  <span class="muted">
                    · {{ device.online ? t('settings.network.online') : t('settings.network.offline') }}
                  </span>
                </span>
                <button type="button" @click="emit('revokeDevice', device.id)">
                  {{ t('settings.network.revoke') }}
                </button>
              </li>
            </ul>
            <p v-else class="muted">{{ t('settings.network.noClients') }}</p>
          </template>

          <p v-else class="muted">{{ t('settings.network.unavailable') }}</p>
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

          <button type="button" @click="emit('openFolder', 'plugins')">
            {{ t('settings.plugins.openFolder') }}
          </button>
        </section>

        <section v-else-if="section === 'icons'">
          <h2>{{ t('settings.icons.title') }}</h2>
          <p class="muted">{{ t('settings.icons.explanation') }}</p>
          <p class="muted small">{{ t('settings.icons.formats') }}</p>

          <button type="button" @click="emit('openFolder', 'icons')">
            {{ t('settings.icons.openFolder') }}
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
            <dd>{{ state.decks.map((deck) => deck.name).join(', ') || '—' }}</dd>
            <dt>{{ t('settings.deck.layout') }}</dt>
            <dd>{{ state.decks[0] ? `${state.decks[0].rows} × ${state.decks[0].cols}` : '—' }}</dd>
            <dt>{{ t('settings.deck.keySize') }}</dt>
            <dd>{{ state.decks[0] ? `${state.decks[0].keyWidth} × ${state.decks[0].keyHeight}` : '—' }}</dd>
            <dt>{{ t('settings.deck.brightness') }}</dt>
            <dd>{{ state.brightness }}%</dd>
          </dl>
          <p v-else class="muted">{{ t('status.noDeck') }}</p>
        </section>

        <section v-else>
          <h2>{{ t('settings.about.title') }}</h2>
          <p>{{ t('settings.about.text') }}</p>
          <button type="button" @click="emit('openFolder', 'config')">
            {{ t('settings.about.openConfig') }}
          </button>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.switch {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 10px 0;
}

.switch small {
  display: block;
}

.addresses,
.clients {
  list-style: none;
  padding: 0;
  margin: 8px 0 16px;
}

.addresses li,
.clients li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.clients .code {
  margin-left: auto;
  font-size: 16px;
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
}

.deck-link {
  margin-left: auto;
}

.status-line {
  margin-top: 8px;
}

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
