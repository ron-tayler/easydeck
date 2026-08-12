/**
 * Marks for the actions themselves, kept apart from the key icon library.
 *
 * Two different jobs. The key library is art someone chooses to put on a
 * button and stares at from a metre away; these are read at palette size,
 * next to a word that already says what the action does. Mixing them would
 * mean every "set variable" symbol turning up when someone is looking for a
 * picture of a microphone.
 *
 * A plugin may name one of these, or supply its own drawing as a data URL —
 * see `ActionDefinition.icon`. An unknown name draws the fallback rather than
 * nothing, so a plugin written against a newer set still shows a palette.
 */

/** Drawn in a 24×24 box, filled with the current colour. */
export const ACTION_ICONS: Readonly<Record<string, string>> = {
  // Navigation
  home: 'M12 3 3 11h2v9h6v-6h2v6h6v-9h2z',
  up: 'M12 4l7 7h-4v9h-6v-9H5z',
  back: 'M11 4l-7 8 7 8v-5h9V9h-9z',
  folder: 'M3 5h6l2 3h10v11H3z',
  'folder-open': 'M3 5h6l2 3h10v3H8l-3 8H3z',
  page: 'M6 3h8l4 4v14H6zm8 1v4h4z',

  // Variables and state
  variable: 'M5 4h4v4H5zm10 0h4v4h-4zM5 16h4v4H5zm10 0h4v4h-4zM9 6h6v2H9zm0 10h6v2H9zm-2-6h2v6H7zm8 0h2v6h-2z',
  toggle: 'M8 7h8a5 5 0 010 10H8A5 5 0 018 7zm8 2a3 3 0 100 6 3 3 0 000-6z',
  increment: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  cycle: 'M12 5a7 7 0 016.9 5.8l1.9-.6A9 9 0 0012 3v2zm0 14a7 7 0 01-6.9-5.8l-1.9.6A9 9 0 0012 21v-2zM19 3v6h-6zM5 21v-6h6z',
  state: 'M4 6h16v5H4zm0 7h16v5H4zm2-5h3v1H6zm0 7h3v1H6z',

  // Time
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zm1 4v5l4 2-1 2-5-3V7z',

  // The panel itself
  brightness: 'M12 8a4 4 0 100 8 4 4 0 000-8zm0-6l2 3h-4zm0 20l-2-3h4zM2 12l3-2v4zm20 0l-3 2v-4zM5 5l3 1-2 2zm14 14l-3-1 2-2zM19 5l-1 3-2-2zM5 19l1-3 2 2z',
  sleep: 'M13 3a9 9 0 108 13A9 9 0 0113 3z',
  wake: 'M12 7a5 5 0 100 10 5 5 0 000-10zm0-6l2 4h-4zm0 22l-2-4h4zM1 12l4-2v4zm22 0l-4 2v-4z',

  // Keyboard and text
  text: 'M4 5h16v3h-6v11h-4V8H4z',
  keyboard: 'M3 7h18v10H3zm3 2v2h2V9zm4 0v2h2V9zm4 0v2h2V9zM6 13v2h12v-2z',
  // A padlock: the one action whose value the profile never sees.
  password: 'M12 2a5 5 0 0 0-5 5v3H5v12h14V10h-2V7a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3zm0 10a2 2 0 0 1 1 3.7V19h-2v-1.3A2 2 0 0 1 12 14z',

  // Sound and playback
  'play-pause': 'M4 5l7 7-7 7zM14 5h2v14h-2zm4 0h2v14h-2z',
  stop: 'M6 6h12v12H6z',
  previous: 'M6 5h2v14H6zm13 0v14l-10-7z',
  next: 'M16 5h2v14h-2zM5 5l10 7-10 7z',
  'volume-up': 'M3 9h3l4-4v14l-4-4H3zM13 12h8v2h-8zM16 9h2v8h-2z',
  'volume-down': 'M3 9h3l4-4v14l-4-4H3zM13 12h8v2h-8z',
  mute: 'M3 9h3l4-4v14l-4-4H3zm11.6.2L13.2 10.6 15.6 13l-2.4 2.4 1.4 1.4L17 14.4l2.4 2.4 1.4-1.4L18.4 13l2.4-2.4-1.4-1.4L17 11.6z',
  // A box with a cone in it: the device the sound comes out of, as opposed to
  // the loudness of it, which the speaker-with-waves above already means.
  speaker: 'M6 2h12v20H6zm6 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',

  // Programs and the world outside
  app: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  link: 'M10 6h4a5 5 0 010 10h-4v-2h4a3 3 0 000-6h-4zm-1 4h6v2H9zm-3-4h4v2H6a3 3 0 000 6h4v2H6A5 5 0 016 6z',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 2c1.4 0 2.8 2.6 3 6h-6c.2-3.4 1.6-6 3-6zM5.1 11h3.9c.1-2.3.6-4.3 1.4-5.6A7 7 0 005.1 11zm0 2a7 7 0 005.3 5.6c-.8-1.3-1.3-3.3-1.4-5.6zm5.9 0h6c-.2 3.4-1.6 6-3 6s-2.8-2.6-3-6zm7.9 0a7 7 0 01-5.3 5.6c.8-1.3 1.3-3.3 1.4-5.6zm0-2h-3.9c-.1-2.3-.6-4.3-1.4-5.6A7 7 0 0118.9 11z',

  // Anything a plugin names that this set does not know
  fallback: 'M12 4a8 8 0 100 16 8 8 0 000-16zm-1 11h2v2h-2zm.2-8h1.6c1.7 0 2.7 1 2.7 2.4 0 1.1-.5 1.7-1.5 2.3-.7.4-.9.7-.9 1.3v.4h-2v-.6c0-1.1.4-1.7 1.4-2.3.7-.4.9-.7.9-1.1 0-.5-.4-.8-1-.8s-1 .4-1.1 1H9c.1-1.6 1.1-2.6 2.2-2.6z',
};

export const FALLBACK_ACTION_ICON = 'fallback';

/**
 * The drawing for an action's icon, whatever form it came in.
 *
 * A data URL is a plugin's own art and is used as-is; a name is looked up
 * here. Anything unrecognised falls back rather than leaving a hole in the
 * grid — a palette with gaps in it reads as broken.
 */
export function actionIconPath(icon: string | undefined): string {
  if (!icon) return ACTION_ICONS[FALLBACK_ACTION_ICON]!;
  return ACTION_ICONS[icon] ?? ACTION_ICONS[FALLBACK_ACTION_ICON]!;
}

export function isDrawnIcon(icon: string | undefined): boolean {
  return typeof icon === 'string' && icon.startsWith('data:');
}
