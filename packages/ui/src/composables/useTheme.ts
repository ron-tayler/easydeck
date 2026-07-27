import { ref } from 'vue';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = 'easydeck.theme';

/**
 * Theme selection, persisted.
 *
 * `system` deliberately removes the attribute rather than resolving the
 * preference itself, so the stylesheet's media query stays in charge and the
 * window follows the OS while it is open — including when the user flips it.
 */
const theme = ref<Theme>(read());

function read(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return (THEMES as readonly string[]).includes(stored ?? '') ? (stored as Theme) : 'system';
}

function apply(value: Theme): void {
  if (value === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', value);
}

apply(theme.value);

export function useTheme() {
  return {
    theme,
    setTheme(value: Theme) {
      theme.value = value;
      localStorage.setItem(STORAGE_KEY, value);
      apply(value);
    },
  };
}
