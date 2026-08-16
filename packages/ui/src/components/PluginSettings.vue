<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  LocalizedText,
  ParamDefinition,
  PluginCommand,
  PluginManifest,
  VariableValue,
} from '@easydeck/protocol';

import NameList from './NameList.vue';
import { confirmAction } from '../composables/useConfirm.js';

/**
 * What a plugin needs to be told, drawn from what it declared.
 *
 * The same parameter definitions an action's parameters use, so a plugin
 * still ships no interface of its own and this window works for the next
 * plugin as well as for OBS.
 *
 * A secret is never received, only reported as filled in or not. The box
 * shows whether there is something stored and takes a replacement; leaving it
 * alone leaves the stored value alone, and emptying it deliberately clears
 * it. That is why the form sends only what was touched rather than everything
 * on screen — sending the whole form back would erase every token the moment
 * somebody changed a port.
 */

const props = defineProps<{
  plugin: PluginManifest;
  values: Readonly<Record<string, VariableValue>>;
  /** Names of the secret fields that have something stored. */
  filledSecrets: readonly string[];
  status: string;
  message?: LocalizedText;
  /** What a command last said, if anything. */
  note?: string;
  busy?: boolean;
  /**
   * Asks the plugin for the choices behind a setting it declared with
   * `optionsFrom` — the speakers it found on the network.
   *
   * The same function the action forms use. Without it a setting like "which
   * speaker" drew an empty list, which is the one thing worse than a text box:
   * a box invites a name, and an empty list says there is nothing to choose.
   */
  loadOptions?: (
    pluginId: string,
    source: string,
    params: Readonly<Record<string, unknown>>,
  ) => Promise<readonly { value: string; label?: LocalizedText }[]>;
}>();

const emit = defineEmits<{
  save: [values: Record<string, VariableValue>];
  command: [name: string];
  close: [];
}>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en);

/**
 * What to draw, which is not everything the plugin declared.
 *
 * A setting marked `internal` is the plugin's own bookkeeping — a list of
 * speakers it found, with a token for each. It has to be declared so it can be
 * stored, and it has no business being a box: nobody can fill it in, and a
 * sealed one shows up as an empty password field asking to be guessed at.
 */
const fields = computed<readonly ParamDefinition[]>(() =>
  (props.plugin.settings ?? []).filter((field) => !field.internal),
);

/**
 * The form, held apart from what was loaded.
 *
 * Typed into rather than bound straight to the props: the window stays open
 * while the plugin reconnects behind it, and a reload arriving mid-sentence
 * must not rewrite the box under the cursor.
 */
const draft = ref<Record<string, string>>({});
/** Which boxes the user actually touched, and so what is worth sending. */
const touched = ref(new Set<string>());

watch(
  () => props.plugin.id,
  () => {
    const next: Record<string, string> = {};
    for (const field of fields.value) {
      if (field.secret) {
        next[field.name] = '';
        continue;
      }
      const value = props.values[field.name] ?? field.default;
      next[field.name] = value === undefined ? '' : String(value);
    }
    draft.value = next;
    touched.value = new Set();
    void loadChoices();
  },
  { immediate: true },
);

function set(field: ParamDefinition, raw: string): void {
  draft.value = { ...draft.value, [field.name]: raw };
  touched.value = new Set(touched.value).add(field.name);
}

const filled = (field: ParamDefinition): boolean => props.filledSecrets.includes(field.name);

/**
 * The choices a plugin answers with, per setting that asked for them.
 *
 * Refreshed when the window opens and after every command, because the command
 * is usually what fills them in: pressing "Find speakers" and then having to
 * close and reopen the window to see them would be the plugin working and the
 * window pretending otherwise.
 */
const dynamic = ref<Record<string, readonly { value: string; label?: LocalizedText }[]>>({});

async function loadChoices(): Promise<void> {
  for (const field of fields.value) {
    if (!field.optionsFrom || !props.loadOptions) continue;

    try {
      const options = await props.loadOptions(props.plugin.id, field.optionsFrom, {});
      dynamic.value = { ...dynamic.value, [field.name]: options };
    } catch {
      dynamic.value = { ...dynamic.value, [field.name]: [] };
    }
  }
}

/** What to put in a select: whatever the plugin answered, or what it declared. */
const choices = (field: ParamDefinition): readonly { value: string; label?: LocalizedText }[] =>
  field.optionsFrom ? (dynamic.value[field.name] ?? []) : (field.options ?? []);

/**
 * Runs a command, asking first when the plugin said to ask.
 *
 * A command acts the moment it is pressed and some of them throw access away —
 * signing out of an account, revoking a token — which is why the manifest can
 * carry a question. Suppression is keyed per plugin and command, so ticking
 * "do not ask again" for one plugin's Sign out does not disarm another's.
 */
async function runCommand(command: PluginCommand): Promise<void> {
  const question = say(command.confirm);
  if (question) {
    const kind = `plugin-command:${props.plugin.id}:${command.name}`;
    if (!(await confirmAction(kind, say(command.label), question))) return;
  }

  emit('command', command.name);
}

/**
 * A command has finished doing whatever it does.
 *
 * Watched rather than emitted back, because the parent is what knows: `busy`
 * goes up while the command runs and down when it is done, and what it did may
 * well be the thing that gives this window something to offer.
 */
watch(
  () => props.busy,
  (now, before) => {
    if (before === true && now !== true) void loadChoices();
  },
);

function save(): void {
  const values: Record<string, VariableValue> = {};

  for (const field of fields.value) {
    if (!touched.value.has(field.name)) continue;

    const raw = draft.value[field.name] ?? '';
    if (field.type === 'number') values[field.name] = Number(raw);
    else if (field.type === 'boolean') values[field.name] = raw === 'true';
    else values[field.name] = raw;
  }

  // Nothing is sent twice: what was saved is no longer something the user
  // has changed, and a secret box is emptied because its contents are now
  // stored rather than pending.
  touched.value = new Set();
  for (const field of fields.value) {
    if (field.secret) draft.value = { ...draft.value, [field.name]: '' };
  }

  emit('save', values);
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true">
      <header>
        <h2>{{ say(plugin.name) }}</h2>
        <button type="button" class="close" :aria-label="t('prompt.cancel')" @click="emit('close')">
          ✕
        </button>
      </header>

      <p v-if="say(plugin.description)" class="muted desc">{{ say(plugin.description) }}</p>

      <!-- The status in words, above the fields that decide it: a person
           reading "nothing is listening on that port" is looking at the port
           box a line below. -->
      <p class="status" :class="status">
        <span class="lamp" :class="status" />
        <span>{{ t(`plugins.status.${status}`) }}</span>
        <span v-if="say(message)" class="muted">— {{ say(message) }}</span>
      </p>

      <form @submit.prevent="save">
        <label
          v-for="field in fields"
          :key="field.name"
          class="field"
          :class="{ tick: field.type === 'boolean' }"
        >
          <span>{{ say(field.label) }}</span>

          <!-- A box to tick rather than a list of two: this is the shape a
               plugin's own switch wants, and a switch is what most booleans
               here will be. -->
          <input
            v-if="field.type === 'boolean'"
            type="checkbox"
            class="switch"
            :checked="draft[field.name] === 'true'"
            @change="set(field, ($event.target as HTMLInputElement).checked ? 'true' : 'false')"
          />

          <select
            v-else-if="field.type === 'select'"
            :value="draft[field.name]"
            @change="set(field, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="option in choices(field)" :key="option.value" :value="option.value">
              {{ say(option.label) || option.value }}
            </option>
          </select>

          <!-- Rows with an add button, because "one per line in a textarea" is
               a storage detail and not something to hand to anybody. -->
          <NameList
            v-else-if="field.type === 'list'"
            :model-value="draft[field.name] ?? ''"
            :placeholder="say(field.placeholder)"
            @update:model-value="set(field, $event)"
          />

          <input
            v-else-if="field.secret"
            type="password"
            autocomplete="off"
            :value="draft[field.name]"
            :placeholder="filled(field) ? t('plugins.secretStored') : t('plugins.secretEmpty')"
            @input="set(field, ($event.target as HTMLInputElement).value)"
          />

          <input
            v-else
            :type="field.type === 'number' ? 'number' : 'text'"
            :value="draft[field.name]"
            :placeholder="say(field.placeholder)"
            :min="field.min"
            :max="field.max"
            @input="set(field, ($event.target as HTMLInputElement).value)"
          />

          <span v-if="say(field.description)" class="muted desc">{{ say(field.description) }}</span>
        </label>

        <p v-if="fields.length === 0" class="muted desc">{{ t('plugins.nothingToSet') }}</p>
      </form>

      <!-- Commands live at the foot, apart from the fields: they act now,
           where a field only takes effect on Save. -->
      <div v-if="(plugin.commands ?? []).length > 0" class="commands">
        <button
          v-for="command in plugin.commands ?? []"
          :key="command.name"
          type="button"
          :disabled="busy"
          :title="say(command.description)"
          @click="runCommand(command)"
        >
          {{ say(command.label) }}
        </button>
      </div>

      <p v-if="note" class="note">{{ note }}</p>

      <!-- Save stays, Close leaves. The window is where you watch the lamp
           turn green after typing a password, so saving must not take it
           away — and a plugin reconnects on save by itself, which is the
           thing worth watching. -->
      <footer>
        <button type="button" class="primary" :disabled="busy" @click="save">
          {{ t('editor.save') }}
        </button>
        <button type="button" @click="emit('close')">{{ t('plugins.close') }}</button>
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
  z-index: 40;
}

.dialog {
  width: min(460px, 92vw);
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

.status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  margin: 12px 0 4px;
}

.lamp {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--text-muted);
}

.lamp.ready {
  background: #3fae63;
}

.lamp.connecting {
  background: #d3a038;
}

.lamp.error {
  background: #d4544a;
}

form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 14px 0 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

/* A tick sits beside its label rather than under it. */
.field.tick {
  flex-direction: row-reverse;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.switch {
  width: 15px;
  height: 15px;
  flex: none;
  margin: 0;
}

.commands {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0 0;
  padding: 12px 0 0;
  border-top: 1px solid var(--border);
}

.note {
  font-size: 12px;
  margin: 10px 0 0;
  color: var(--text-muted);
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 18px 0 0;
}
</style>
