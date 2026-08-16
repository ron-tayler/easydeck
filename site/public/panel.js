/**
 * The panel on the landing page, working the way the program works.
 *
 * Not a picture of a deck: a small copy of the real thing. Keys have states
 * bound to variables, a variable that moves repaints the keys that read it,
 * folders open, and the four widgets draw themselves rather than sitting there
 * as a screenshot. Somebody who presses the microphone here has seen what the
 * program does, which no amount of prose achieves.
 *
 * Everything is drawn — SVG icons and CSS animation, no bitmaps and no GIFs.
 * A GIF of a level meter is a hundred kilobytes that is blurry on a retina
 * screen and wrong in the other colour scheme; the same meter as elements is
 * two hundred bytes and correct in both.
 */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --- the drawings ---------------------------------------------------------
 *
 * One weight, one style, all on a 24 grid and all in `currentColor`, so a key
 * colours its icon by colouring itself.
 */

const svg = (paths) =>
  `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICONS = {
  mic: svg('<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/>'),
  micOff: svg('<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/><path d="M3.5 3.5l17 17"/>'),
  headphones: svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2.5" y="14" width="5" height="7" rx="2"/><rect x="16.5" y="14" width="5" height="7" rx="2"/>'),
  headphonesOff: svg('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2.5" y="14" width="5" height="7" rx="2"/><rect x="16.5" y="14" width="5" height="7" rx="2"/><path d="M3 3l18 18"/>'),
  record: svg('<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>'),
  camera: svg('<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 11l6-3.5v9L15.5 13z"/>'),
  folder: svg('<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5z"/>'),
  back: svg('<path d="M10 6l-6 6 6 6"/><path d="M4 12h11a5 5 0 0 1 5 5v1"/>'),
  louder: svg('<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9a4.5 4.5 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/>'),
  quieter: svg('<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16.5 10.5l4 4"/><path d="M20.5 10.5l-4 4"/>'),
  pad: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9.5 9.5v5l4.5-2.5z" fill="currentColor"/>'),
  bulb: svg('<path d="M9 17h6"/><path d="M10 20.5h4"/><path d="M12 3a6 6 0 0 1 3.5 10.9V17h-7v-3.1A6 6 0 0 1 12 3z"/>'),
  chat: svg('<path d="M4 5.5h16v11H12l-4.5 4v-4H4z"/><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"/>'),
  game: svg('<rect x="2.5" y="7.5" width="19" height="10" rx="4.5"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r="1" fill="currentColor"/><circle cx="18.5" cy="14" r="1" fill="currentColor"/>'),
  alice: svg('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12a3.5 3.5 0 0 0 7 0"/><path d="M9 9h.01M15 9h.01"/>'),
  cross: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

/* --- variables, and what listens to them ---------------------------------- */

const values = new Map();
const listeners = new Set();

function get(name) {
  return values.get(name);
}

function set(name, value) {
  if (values.get(name) === value) return;
  values.set(name, value);
  for (const listen of listeners) listen(name);
}

/** `{{name}}`, the same placeholder the program's labels use. */
function fill(text) {
  return String(text ?? '').replace(/\{\{([^}]+)\}\}/g, (_, name) => String(get(name.trim()) ?? ''));
}

/* --- the pages -------------------------------------------------------------
 *
 * A key is a list of appearances and the variable that decides which one
 * shows, exactly as a profile stores it. Nothing here is a special case for
 * the demo: `when`, `stateFrom` and the templates in labels are the real
 * shapes.
 */

const PAGES = {
  main: [
    {
      stateFrom: 'mic',
      states: [
        { when: true, label: 'Микрофон', icon: 'mic', tone: 'good' },
        { when: false, label: 'Выключен', icon: 'micOff', tone: 'bad' },
      ],
      press: () => set('mic', !get('mic')),
      title: 'Микрофон: нажмите, чтобы выключить',
    },
    {
      stateFrom: 'scene',
      states: [
        { when: 'Игра', label: 'Игра', icon: 'game', tone: 'cool' },
        { when: 'Камера', label: 'Камера', icon: 'camera', tone: 'cool' },
        { when: 'Пауза', label: 'Пауза', icon: 'cross', tone: 'plain' },
      ],
      press: () => {
        const order = ['Игра', 'Камера', 'Пауза'];
        set('scene', order[(order.indexOf(get('scene')) + 1) % order.length]);
      },
      title: 'Сцена OBS: нажмите, чтобы переключить',
    },
    {
      stateFrom: 'rec',
      states: [
        { when: false, label: 'Запись', icon: 'record', tone: 'plain' },
        { when: true, label: '{{recTime}}', icon: 'record', tone: 'bad', beat: true },
      ],
      press: () => set('rec', !get('rec')),
      title: 'Запись: нажмите, чтобы начать',
    },
    { widget: 'cover', wide: true, title: 'Виджет: обложка того, что играет — на две клавиши' },

    {
      label: 'Тише',
      icon: 'quieter',
      tone: 'plain',
      press: () => set('volume', Math.max(0, get('volume') - 10)),
      title: 'Громкость тише',
    },
    {
      label: '{{volume}}%',
      icon: 'louder',
      tone: 'plain',
      press: () => set('volume', Math.min(100, get('volume') + 10)),
      title: 'Громкость громче',
    },
    { widget: 'meter', reads: ['volume'], title: 'Виджет: уровень звука' },
    {
      label: 'Discord',
      icon: 'chat',
      tone: 'cool',
      press: () => open('discord'),
      title: 'Папка Discord',
      folder: true,
    },
    { widget: 'clock', reads: ['clock', 'date'], title: 'Виджет: часы' },

    {
      label: 'Смех',
      icon: 'pad',
      tone: 'plain',
      press: (key) => flash(key),
      title: 'Звук из Soundpad',
    },
    {
      label: 'Фанфары',
      icon: 'pad',
      tone: 'plain',
      press: (key) => flash(key),
      title: 'Звук из Soundpad',
    },
    {
      stateFrom: 'light',
      states: [
        { when: true, label: 'Свет', icon: 'bulb', tone: 'warm' },
        { when: false, label: 'Свет', icon: 'bulb', tone: 'plain' },
      ],
      press: () => set('light', !get('light')),
      title: 'Свет в комнате',
    },
    { label: 'Алиса', icon: 'alice', tone: 'cool', press: (key) => flash(key), title: 'Сказать колонке' },
    {
      stateFrom: 'sound',
      states: [
        { when: true, label: 'Звук', icon: 'headphones', tone: 'plain' },
        { when: false, label: 'Оглушён', icon: 'headphonesOff', tone: 'bad' },
      ],
      press: () => set('sound', !get('sound')),
      title: 'Наушники',
    },
  ],

  discord: [
    { label: 'Назад', icon: 'back', tone: 'plain', press: () => open('main'), title: 'Вернуться' },
    {
      stateFrom: 'mic',
      states: [
        { when: true, label: 'Микрофон', icon: 'mic', tone: 'good' },
        { when: false, label: 'Выключен', icon: 'micOff', tone: 'bad' },
      ],
      press: () => set('mic', !get('mic')),
      title: 'Тот же микрофон: переменная одна на всю машину',
    },
    {
      stateFrom: 'sound',
      states: [
        { when: true, label: 'Звук', icon: 'headphones', tone: 'plain' },
        { when: false, label: 'Оглушён', icon: 'headphonesOff', tone: 'bad' },
      ],
      press: () => set('sound', !get('sound')),
    },
    { widget: 'speakers', wide: true, title: 'Виджет: кто сейчас говорит' },

    { label: 'Общий\n{{members}} чел.', tone: 'cool', press: () => set('members', ((get('members') + 1) % 9) + 1), title: 'Голосовой канал' },
    { label: 'Игровой\n2 чел.', tone: 'plain', press: (key) => flash(key) },
    { label: 'Тише\nСосед', icon: 'quieter', tone: 'plain', press: (key) => flash(key) },
    { label: 'Выйти', icon: 'cross', tone: 'plain', press: (key) => flash(key) },
    { widget: 'clock', reads: ['clock', 'date'] },

    { empty: true },
    { empty: true },
    { empty: true },
    { empty: true },
    { empty: true },
  ],
};

let page = 'main';

function open(name) {
  page = name;
  draw();
}

/** A momentary press, for a key whose job is over the instant it is pressed. */
function flash(key) {
  key.classList.add('hit');
  setTimeout(() => key.classList.remove('hit'), 320);
}

/* --- choosing an appearance ------------------------------------------------
 *
 * The same order the program uses, minus the parts a demo cannot show: a state
 * whose `when` equals the value wins, and failing that the first state does.
 */
function appearanceOf(spec) {
  if (!spec.states) return spec;

  const value = get(spec.stateFrom);
  return spec.states.find((state) => state.when === value) ?? spec.states[0];
}

/* --- the widgets -----------------------------------------------------------
 *
 * Four pictures that draw themselves. In the program these come from plugins
 * and are redrawn only while the key is on screen; here they are CSS, which
 * has the same property for free — an animation on a hidden element costs
 * nothing.
 */

const WIDGETS = {
  meter: () => `
    <div class="w meter" style="--level: ${get('volume')}">
      ${[0, 1, 2, 3, 4].map((n) => `<i style="--n:${n}"></i>`).join('')}
    </div>`,

  cover: () => `
    <div class="w cover">
      <div class="art"></div>
      <div class="track"><b>Полёт</b><span>Кто-то знакомый</span></div>
    </div>`,

  speakers: () => `
    <div class="w faces">
      <span class="face a">М</span>
      <span class="face b">С</span>
    </div>`,

  clock: () => `<div class="w clock"><b>${get('clock')}</b><span>${get('date')}</span></div>`,
};

/* --- drawing ---------------------------------------------------------------- */

const root = document.getElementById('panel');

/**
 * Every variable this key's appearance depends on.
 *
 * The same three sources the program looks at — the variable a state is bound
 * to, the templates in every state's label, and what a widget says it reads —
 * and worked out once per key rather than on every tick.
 */
function readsOf(spec) {
  if (spec.reading) return spec.reading;

  const names = new Set(spec.reads ?? []);
  if (spec.stateFrom) names.add(spec.stateFrom);
  for (const state of spec.states ?? [spec]) {
    for (const found of String(state.label ?? '').matchAll(/\{\{([^}]+)\}\}/g)) {
      names.add(found[1].trim());
    }
  }

  spec.reading = names;
  return names;
}

function html(spec, index) {
  if (spec.empty) return '<div class="key empty" aria-hidden="true"></div>';

  const look = appearanceOf(spec);
  const widget = spec.widget ? WIDGETS[spec.widget]() : '';
  const label = fill(look.label ?? '').replace('\n', '<br>');
  const pressed = spec.stateFrom !== undefined ? ` aria-pressed="${Boolean(get(spec.stateFrom))}"` : '';

  const classes = `key ${look.tone ?? 'plain'}${look.beat ? ' beat' : ''}${spec.widget ? ' widget' : ''}${spec.wide ? ' wide' : ''}${spec.folder ? ' folder' : ''}`;
  const face = `${widget}${look.icon ? ICONS[look.icon] : ''}${label ? `<span class="lab">${label}</span>` : ''}`;

  /*
   * A key is a button only when pressing it does something.
   *
   * A widget is a picture; as a `<button>` it would take a stop on the way
   * through with the keyboard and then do nothing when pressed, which is the
   * sort of thing that makes a page tiring to use with one.
   */
  return spec.press
    ? `<button class="${classes}" type="button" data-key="${index}"${pressed} title="${spec.title ?? ''}">${face}</button>`
    : `<div class="${classes}" title="${spec.title ?? ''}">${face}</div>`;
}

/** The whole page, for a page that has just been opened. */
function draw() {
  if (!root) return;
  root.innerHTML = PAGES[page].map(html).join('');
}

/**
 * One variable moved, so the keys that read it are drawn again — and only
 * those.
 *
 * The demo had the bug the program itself was cured of a week ago: any change
 * redrew all fifteen keys. Starting the recording timer therefore rebuilt the
 * album art and the faces once a second, which restarted their animations from
 * the beginning — the record jumped back to the top of every turn and never
 * finished one.
 */
function update(changed) {
  if (!root) return;

  const keys = PAGES[page];
  const scratch = document.createElement('div');

  keys.forEach((spec, index) => {
    if (changed !== undefined && !readsOf(spec).has(changed)) return;

    scratch.innerHTML = html(spec, index);
    root.children[index]?.replaceWith(scratch.firstElementChild);
  });
}

root?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-key]');
  if (!button) return;

  const spec = PAGES[page][Number(button.dataset.key)];
  spec?.press?.(button);
});

listeners.add(update);

/* --- the two things that genuinely tick ------------------------------------- */

function tick() {
  const now = new Date();
  const two = (value) => String(value).padStart(2, '0');

  set('clock', `${two(now.getHours())}:${two(now.getMinutes())}`);
  set('date', now.toLocaleDateString('ru', { weekday: 'short', day: 'numeric', month: 'short' }));

  if (get('rec')) {
    const seconds = get('recSeconds') + 1;
    set('recSeconds', seconds);
    set('recTime', `${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`);
  } else if (get('recSeconds') !== 0) {
    set('recSeconds', 0);
    set('recTime', 'Запись');
  }
}

values.set('mic', true);
values.set('sound', true);
values.set('rec', false);
values.set('recSeconds', 0);
values.set('recTime', 'Запись');
values.set('scene', 'Игра');
values.set('volume', 60);
values.set('light', false);
values.set('members', 4);
values.set('clock', '');
values.set('date', '');

tick();
draw();

/*
 * The clock stops when nobody is looking at it.
 *
 * The same bargain the program makes with its widgets, and here it is one
 * observer: a page left open in a background tab has no business waking the
 * machine once a second to move a colon.
 */
if (!REDUCED && root) {
  let timer;
  new IntersectionObserver((entries) => {
    const visible = entries.some((entry) => entry.isIntersecting);
    clearInterval(timer);
    if (visible) timer = setInterval(tick, 1000);
  }).observe(root);
}
