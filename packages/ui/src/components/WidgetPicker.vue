<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LocalizedText, PluginManifest, SurfaceDefinition, SurfaceSpec } from '@easydeck/core';

/**
 * A picture a plugin draws, chosen for a key.
 *
 * Called a widget here and a surface everywhere below, deliberately: "surface"
 * says what it is to the compositor, and "widget" is what somebody putting a
 * graph of the processor on a key thinks they are doing.
 *
 * Sits beside the picture rather than inside it. The two are alternatives for
 * one slot — a key shows one or the other — but they are chosen in different
 * ways, and folding a list of plugin widgets into the icon library would make
 * the library answer a question it is not about.
 */

const props = defineProps<{
  label?: string;
  surface?: SurfaceSpec;
  plugins: readonly PluginManifest[];
}>();

const emit = defineEmits<{ update: [surface: SurfaceSpec | undefined] }>();

const { t, locale } = useI18n();

const say = (text: LocalizedText | undefined): string =>
  text === undefined ? '' : (text[locale.value] ?? text.en ?? '');

const browsing = ref(false);

/** Every widget on offer, with the plugin that brought it. */
const offered = computed(() =>
  props.plugins.flatMap((plugin) =>
    (plugin.surfaces ?? []).map((surface) => ({ plugin, surface })),
  ),
);

const chosen = computed(() =>
  offered.value.find((each) => each.surface.type === props.surface?.type),
);

/**
 * What the button says when the plugin behind it is gone.
 *
 * The type rather than a shrug: it names what is missing, which is the only
 * useful thing left to say, and matches what the key itself will show.
 */
const title = computed(() => {
  if (!props.surface) return t('editor.widget.choose');
  return chosen.value ? say(chosen.value.surface.label) : props.surface.type;
});

function pick(surface: SurfaceDefinition): void {
  browsing.value = false;
  if (surface.type === props.surface?.type) return;

  // Defaults from the form, so a widget shows something the moment it is
  // chosen rather than after a trip through its settings.
  const params: Record<string, unknown> = {};
  for (const param of surface.params ?? []) {
    if (param.default !== undefined) params[param.name] = param.default;
  }

  emit('update', { type: surface.type, params });
}
</script>

<template>
  <span class="widget">
    <span class="row">
      <button
        type="button"
        class="choose"
        :class="{ wide: label, empty: !surface, orphan: surface && !chosen }"
        :title="title"
        @click="browsing = true"
      >
        <!-- Four little panes: the sign for a thing that draws itself. -->
        <svg class="glyph" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
          <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
          <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
          <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
        </svg>
        <span v-if="label" class="name">{{ surface ? title : label }}</span>
      </button>

      <slot name="tools" />

      <button
        v-if="surface"
        type="button"
        class="clear"
        :title="t('editor.widget.clear')"
        :aria-label="t('editor.widget.clear')"
        @click="emit('update', undefined)"
      >
        ✕
      </button>
    </span>

    <div v-if="browsing" class="backdrop" @click.self="browsing = false">
      <div class="sheet" role="dialog" aria-modal="true">
        <h2>{{ t('editor.widget.title') }}</h2>

        <p v-if="offered.length === 0" class="none">{{ t('editor.widget.none') }}</p>

        <ul v-else class="list">
          <li v-for="each in offered" :key="each.surface.type">
            <button
              type="button"
              class="entry"
              :class="{ on: each.surface.type === surface?.type }"
              @click="pick(each.surface)"
            >
              <span class="what">{{ say(each.surface.label) }}</span>
              <span class="who">{{ say(each.plugin.name) }}</span>
              <span v-if="each.surface.description" class="why">
                {{ say(each.surface.description) }}
              </span>
            </button>
          </li>
        </ul>

        <footer>
          <button type="button" @click="browsing = false">{{ t('prompt.cancel') }}</button>
        </footer>
      </div>
    </div>
  </span>
</template>

<style scoped>
/* The chain that lets the row above hand this its share: the wrapper, the row
   inside it and the button all have to agree to stretch, or the width stops at
   the first one that does not. */
.widget { display: flex; min-width: 0; }
.row { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }

.choose {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 9px; border-radius: 8px;
  background: var(--surface-2); border: 1px solid var(--border);
  font-size: 12px; text-align: left; min-width: 0;
}
.choose.wide { flex: 1; }
.choose.empty { color: var(--text-muted); }
/* Its plugin is gone: the same complaint the key itself makes. */
.choose.orphan { border-color: var(--danger); color: var(--danger); }

.glyph { width: 15px; height: 15px; flex: none; fill: currentColor; opacity: 0.75; }

.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.clear { padding: 3px 7px; border-radius: 7px; color: var(--text-muted); }

.backdrop {
  position: fixed; inset: 0; background: rgb(0 0 0 / 45%);
  display: grid; place-items: center; z-index: 40;
}

.sheet {
  width: min(440px, 92vw); max-height: 78vh; overflow: auto;
  background: var(--surface-0); border: 1px solid var(--border);
  border-radius: 12px; padding: 16px 18px 14px;
  box-shadow: 0 18px 48px var(--shadow);
}

h2 { margin: 0 0 12px; font-size: 15px; }
.none { color: var(--text-muted); font-size: 13px; margin: 0; }

.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }

.entry {
  width: 100%; display: grid; gap: 2px;
  padding: 9px 11px; border-radius: 9px;
  background: var(--surface-1); border: 1px solid var(--border);
  text-align: left;
}
.entry.on { border-color: var(--accent); background: var(--accent-soft); }
.entry .what { font-size: 13px; }
.entry .who { font-size: 11px; color: var(--text-muted); }
.entry .why { font-size: 12px; color: var(--text-muted); }

footer { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>
