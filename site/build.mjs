import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Marked } from 'marked';

/**
 * The public page, built from Markdown and a handful of templates.
 *
 * A generator of a hundred lines rather than a framework, because the site is
 * a landing page and two folders of documentation: everything dynamic on it —
 * which installer your machine wants, what the plugin store holds today — is a
 * fetch the browser makes, from data that lives in a repository rather than
 * here. Nothing to render at build time and nothing to keep in sync.
 *
 * Output is a folder of plain files. GitHub Pages serves it, and so does any
 * static server, which is what `serve.mjs` is for.
 */

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');

/**
 * Where the site will live, with a trailing slash.
 *
 * A project page is served from a subfolder — `/easydeck/` — so every link has
 * to carry it. Overridable so the same output can be served from the root of
 * something else, and so `serve.mjs` can hand back `/`.
 */
const base = process.env['SITE_BASE'] ?? '/easydeck/';

const REPO = 'ron-tayler/easydeck';
const PLUGINS_REPO = 'ron-tayler/easydeck-plugins';

/**
 * The order the documentation reads in, which alphabetical order is not.
 *
 * Named here rather than in the files, so a page cannot quietly go missing
 * from the menu by being renamed — a file listed and absent stops the build.
 */
const SECTIONS = [
  {
    slug: 'docs',
    title: 'Документация',
    intro: 'Как устроена программа и что она умеет.',
    pages: [
      ['index', 'Начало'],
      ['profiles', 'Профили, папки и клавиши'],
      ['look', 'Как выглядит клавиша'],
      ['macros', 'Макросы и события'],
      ['variables', 'Переменные'],
      ['plugins', 'Плагины'],
      ['network', 'Сеть, файлы и журнал'],
    ],
  },
  {
    slug: 'dev',
    title: 'Разработчику плагинов',
    intro: 'Как написать плагин, из чего он состоит и как его опубликовать.',
    pages: [
      ['index', 'Плагин за десять минут'],
      ['manifest', 'Манифест'],
      ['host', 'Что даёт хост'],
      ['publishing', 'Сборка и публикация'],
    ],
  },
];

const NAV = [
  ['', 'Главная'],
  ['store/', 'Плагины'],
  ['docs/', 'Документация'],
  ['dev/', 'Разработчикам'],
];

/**
 * Headings get an anchor, because a documentation link points at a paragraph.
 *
 * Marked stopped doing this itself, and the loss is silent: a link written as
 * `…/profiles/#как-значение-выбирает-состояние` simply lands at the top of the
 * page, with nothing anywhere saying it missed.
 *
 * The slug keeps Cyrillic rather than transliterating it. The address bar
 * shows it percent-encoded, but it is the heading, and a reader who copies a
 * link back out gets something they can read.
 */
function slugOf(text, taken) {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'section';

  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  return slug;
}

function renderer() {
  const taken = new Set();

  return {
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const plain = text.replace(/<[^>]+>/g, '');
        return `<h${depth} id="${slugOf(plain, taken)}">${text}</h${depth}>\n`;
      },
    },
  };
}

/** One page, wrapped in everything every page has. */
function shell({ title, description, body, active, aside = '', wide = false }) {
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${base}${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escape(description)}">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:type" content="website">
<link rel="icon" href="${base}logo.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}styles.css">
</head>
<body>
<a class="skip" href="#main">К содержимому</a>
<header class="top">
  <a class="brand" href="${base}">
    <img src="${base}logo.svg" alt="" width="28" height="28">
    <span>EasyDeck</span>
  </a>
  <nav>${nav}</nav>
  <a class="ghost" href="https://github.com/${REPO}" rel="noopener">GitHub</a>
</header>
${aside ? `<div class="withaside">${aside}<main id="main"${wide ? ' class="wide"' : ''}>${body}</main></div>` : `<main id="main"${wide ? ' class="wide"' : ''}>${body}</main>`}
<footer class="bottom">
  <p>EasyDeck — свободная программа под лицензией MIT. Стадия ранней разработки: ломается, чинится и меняется.</p>
  <p>
    <a href="https://github.com/${REPO}" rel="noopener">Исходный код</a> ·
    <a href="https://github.com/${PLUGINS_REPO}" rel="noopener">Плагины</a> ·
    <a href="https://github.com/${REPO}/issues" rel="noopener">Сообщить о проблеме</a>
  </p>
</footer>
</body>
</html>
`;
}

function escape(value) {
  return String(value).replace(/[<>&"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The menu of one documentation section, with the page you are on marked. */
function sidebar(section, current) {
  const links = section.pages
    .map(([slug, label]) => {
      const href = slug === 'index' ? `${base}${section.slug}/` : `${base}${section.slug}/${slug}/`;
      const here = slug === current ? ' class="here"' : '';
      return `<li><a href="${href}"${here}>${label}</a></li>`;
    })
    .join('');

  const others = SECTIONS.filter((one) => one !== section)
    .map((one) => `<a href="${base}${one.slug}/">${one.title} →</a>`)
    .join('');

  return `<aside class="menu">
  <p class="menutitle">${section.title}</p>
  <ul>${links}</ul>
  <p class="menuother">${others}</p>
</aside>`;
}

/** The first heading of a document, which is also its title in the tab. */
function headingOf(markdown, fallback) {
  const found = /^#\s+(.+)$/m.exec(markdown);
  return found ? found[1].trim() : fallback;
}

/** The first paragraph, for the description a search engine shows. */
function summaryOf(markdown) {
  const body = markdown.replace(/^#\s+.+$/m, '').trim();
  const paragraph = body.split(/\n\s*\n/)[0] ?? '';
  return paragraph.replace(/[*_`[\]]/g, '').replace(/\s+/g, ' ').slice(0, 180);
}

async function page(file, replacements = {}) {
  let text = await readFile(join(here, 'pages', file), 'utf8');
  for (const [name, value] of Object.entries({ base, repo: REPO, plugins: PLUGINS_REPO, ...replacements })) {
    text = text.replaceAll(`{{${name}}}`, value);
  }
  return text;
}

async function build() {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(join(here, 'public'), out, { recursive: true });

  // --- the landing and the store ------------------------------------------
  await writeFile(
    join(out, 'index.html'),
    shell({
      title: 'EasyDeck — свободная программа для макро-панелей',
      description:
        'Профили, макросы, переменные и плагины для FIFINE AmpliGame D6 и других панелей: свободная альтернатива фирменному приложению.',
      body: await page('index.html'),
      active: '',
      wide: true,
    }),
  );

  await mkdir(join(out, 'store'), { recursive: true });
  await writeFile(
    join(out, 'store/index.html'),
    shell({
      title: 'Плагины — EasyDeck',
      description: 'Каталог плагинов EasyDeck: скачать вручную и установить в программу.',
      body: await page('store.html'),
      active: 'store/',
      wide: true,
    }),
  );

  // --- the documentation ---------------------------------------------------
  for (const section of SECTIONS) {
    for (const [slug, label] of section.pages) {
      const markdown = await readFile(join(here, 'content', section.slug, `${slug}.md`), 'utf8');
      const folder = slug === 'index' ? join(out, section.slug) : join(out, section.slug, slug);


      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, 'index.html'),
        shell({
          title: `${headingOf(markdown, label)} — EasyDeck`,
          description: summaryOf(markdown),
          // A parser per document: two pages may both have a heading called
          // "Переменные", and neither should become `-2` because of the other.
          body: `<article class="prose">${new Marked(renderer()).parse(markdown)}</article>`,
          active: `${section.slug}/`,
          aside: sidebar(section, slug),
        }),
      );
    }
  }

  // A 404 that still has the menu on it, because a wrong link into a
  // documentation site is usually one heading away from the right one.
  await writeFile(
    join(out, '404.html'),
    shell({
      title: 'Страница не найдена — EasyDeck',
      description: 'Такой страницы нет.',
      body: `<article class="prose"><h1>Такой страницы нет</h1>
<p>Возможно, она переехала. Загляните в <a href="${base}docs/">документацию</a> или на <a href="${base}">главную</a>.</p></article>`,
      active: '',
    }),
  );

  const written = (await readdir(out, { recursive: true })).filter((name) => name.endsWith('.html'));
  console.log(`site: ${written.length} страниц -> ${out}${base === '/' ? '' : ` (база ${base})`}`);
}

await build();
