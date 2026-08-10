import { createI18n } from 'vue-i18n';

import en from './locales/en.js';
import ru from './locales/ru.js';

export const SUPPORTED_LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = 'easydeck.locale';

/**
 * English is the default because the project is meant to be handed to a
 * community that mostly does not read Russian; the browser's own preference
 * still wins on first run, and an explicit choice wins over both.
 */
function initialLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) return stored as Locale;

  const preferred = navigator.language.slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(preferred) ? (preferred as Locale) : 'en';
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { en, ru },
});

/**
 * Lays a plugin's translations over the built-in text.
 *
 * Merged rather than replaced, and merged deeply: a plugin that names one of
 * its own actions must not blank out the section it lands in. Plugins are
 * allowed to win over our own wording — a pack that calls a thing by the name
 * its community uses is right, and we are not there to argue.
 *
 * Called whenever the plugin list is read, so removing a plugin's folder puts
 * the original text back on the next refresh.
 */
export function applyPluginMessages(messages: Readonly<Record<string, unknown>>): void {
  for (const locale of SUPPORTED_LOCALES) {
    const built = locale === 'ru' ? ru : en;
    const extra = messages[locale];

    // The cast is the plugin's own doing: what it ships is JSON off disk, and
    // no type here can promise it matches the built-in shape.
    i18n.global.setLocaleMessage(
      locale,
      (extra ? merge(built, extra) : built) as Parameters<typeof i18n.global.setLocaleMessage>[1],
    );
  }
}

function merge(base: unknown, extra: unknown): unknown {
  if (!isTree(base) || !isTree(extra)) return extra;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    merged[key] = key in merged ? merge(merged[key], value) : value;
  }

  return merged;
}

function isTree(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function setLocale(locale: Locale): void {
  i18n.global.locale.value = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
}
