/**
 * The built-in icon set.
 *
 * SVG paths rather than image files: a path is a line of text that diffs, a
 * PNG is a blob nobody can review. They are rasterized to a PNG data URL at
 * the moment one is chosen, so the device renderer and the profile only ever
 * see bitmaps — the deck has no SVG support and none is worth adding for art
 * that is 112 pixels wide.
 *
 * Deliberately small and geometric. An icon on a key is read at a glance from
 * a metre away, which rules out anything with fine detail.
 */
export interface LibraryIcon {
  readonly id: string;
  /** Matched against what the user types, so searching works in both languages. */
  readonly keywords: readonly string[];
  /** Drawn in a 24×24 box, filled with the current colour. */
  readonly path: string;
}

export const ICON_LIBRARY: readonly LibraryIcon[] = [
  {
    id: 'play',
    keywords: ['play', 'старт', 'воспроизведение', 'пуск'],
    path: 'M8 5v14l11-7z',
  },
  {
    id: 'pause',
    keywords: ['pause', 'пауза'],
    path: 'M6 5h4v14H6zm8 0h4v14h-4z',
  },
  {
    id: 'stop',
    keywords: ['stop', 'стоп'],
    path: 'M6 6h12v12H6z',
  },
  {
    id: 'record',
    keywords: ['record', 'запись'],
    path: 'M12 5a7 7 0 100 14 7 7 0 000-14z',
  },
  {
    id: 'next',
    keywords: ['next', 'вперёд', 'следующий'],
    path: 'M6 5l9 7-9 7zm10 0h3v14h-3z',
  },
  {
    id: 'previous',
    keywords: ['previous', 'назад', 'предыдущий'],
    path: 'M18 5l-9 7 9 7zM5 5h3v14H5z',
  },
  {
    id: 'volume-up',
    keywords: ['volume', 'звук', 'громкость'],
    path: 'M4 9v6h4l5 4V5L8 9zm12.5 3a4 4 0 00-2-3.5v7a4 4 0 002-3.5zM14.5 3.2v2.1a6.7 6.7 0 010 13.4v2.1a8.8 8.8 0 000-17.6z',
  },
  {
    id: 'volume-off',
    keywords: ['mute', 'тихо', 'без звука'],
    path: 'M4 9v6h4l5 4V5L8 9zm16.3 0l-1.4-1.4L16.5 10l-2.4-2.4-1.4 1.4 2.4 2.4-2.4 2.4 1.4 1.4 2.4-2.4 2.4 2.4 1.4-1.4-2.4-2.4z',
  },
  {
    id: 'mic',
    keywords: ['mic', 'микрофон'],
    path: 'M12 14a3 3 0 003-3V6a3 3 0 00-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-4 4.9V19h3v2H8v-2h3v-3.1A5 5 0 017 11h2a3 3 0 006 0z',
  },
  {
    id: 'mic-off',
    keywords: ['mic off', 'микрофон выключен', 'мут'],
    path: 'M12 14a3 3 0 003-3V6a3 3 0 00-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-4 4.9V19h3v2H8v-2h3v-3.1A5 5 0 017 11h2a3 3 0 006 0zM3.3 2L2 3.3 20.7 22l1.3-1.3z',
  },
  {
    id: 'camera',
    keywords: ['camera', 'камера', 'видео'],
    path: 'M4 6h11v12H4zm13 4l4-3v10l-4-3z',
  },
  {
    id: 'screen',
    keywords: ['screen', 'экран', 'монитор'],
    path: 'M3 4h18v12H3zm7 14h4v2h-4zM7 20h10v1H7z',
  },
  {
    id: 'folder',
    keywords: ['folder', 'папка'],
    path: 'M3 5h6l2 2h10v12H3z',
  },
  {
    id: 'home',
    keywords: ['home', 'домой', 'главная'],
    path: 'M12 3L2 12h3v9h6v-6h2v6h6v-9h3z',
  },
  {
    id: 'back',
    keywords: ['back', 'назад'],
    path: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  },
  {
    id: 'up',
    keywords: ['up', 'вверх'],
    path: 'M13 20V7.8l5.6 5.6L20 12l-8-8-8 8 1.4 1.4L11 7.8V20z',
  },
  {
    id: 'plus',
    keywords: ['plus', 'плюс', 'добавить'],
    path: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  },
  {
    id: 'minus',
    keywords: ['minus', 'минус', 'убавить'],
    path: 'M4 11h16v2H4z',
  },
  {
    id: 'check',
    keywords: ['check', 'галочка', 'готово'],
    path: 'M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  },
  {
    id: 'cross',
    keywords: ['close', 'крестик', 'закрыть', 'отмена'],
    path: 'M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  },
  {
    id: 'gear',
    keywords: ['settings', 'настройки', 'шестерёнка'],
    path: 'M12 8a4 4 0 100 8 4 4 0 000-8zm9 4l-2-1.5.4-2.5-2.4-1-1.6 2-2.4-.7L12 2l-1 2.3-2.4.7-1.6-2-2.4 1L5 8.5 3 10l2 1.5-.4 2.5 2.4 1 1.6-2 2.4.7L12 22l1-2.3 2.4-.7 1.6 2 2.4-1-.4-2.5z',
  },
  {
    id: 'power',
    keywords: ['power', 'питание', 'выключить'],
    path: 'M13 3h-2v10h2zm4.8 2.2l-1.4 1.4A7 7 0 1112 5V3a9 9 0 105.8 2.2z',
  },
  {
    id: 'star',
    keywords: ['star', 'звезда', 'избранное'],
    path: 'M12 2l3 6.6 7 .8-5.2 4.8 1.4 7L12 17.8 5.8 21.2l1.4-7L2 9.4l7-.8z',
  },
  {
    id: 'heart',
    keywords: ['heart', 'сердце', 'нравится'],
    path: 'M12 21l-1.5-1.4C5.4 15 2 11.9 2 8.2 2 5.4 4.2 3.2 7 3.2c1.6 0 3.1.7 4 1.9a5.2 5.2 0 014-1.9c2.8 0 5 2.2 5 5 0 3.7-3.4 6.8-8.5 11.4z',
  },
  {
    id: 'bolt',
    keywords: ['bolt', 'молния', 'быстро'],
    path: 'M13 2L4 14h6l-1 8 9-12h-6z',
  },
  {
    id: 'bell',
    keywords: ['bell', 'колокол', 'уведомление'],
    path: 'M12 22a2.5 2.5 0 002.5-2.5h-5A2.5 2.5 0 0012 22zm7-5v-6a7 7 0 00-5.5-6.8V3a1.5 1.5 0 10-3 0v1.2A7 7 0 005 11v6l-2 2v1h18v-1z',
  },
  {
    id: 'chat',
    keywords: ['chat', 'чат', 'сообщение'],
    path: 'M3 4h18v13H8l-5 4z',
  },
  {
    id: 'lock',
    keywords: ['lock', 'замок', 'блокировка'],
    path: 'M6 10V7a6 6 0 1112 0v3h2v12H4V10zm3 0h6V7a3 3 0 10-6 0z',
  },
];

/** Wraps a library path into a standalone SVG document. */
export function iconSvg(icon: LibraryIcon, color = '#ffffff'): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">` +
    `<path fill="${color}" d="${icon.path}"/></svg>`
  );
}
