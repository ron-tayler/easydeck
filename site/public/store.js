/**
 * The plugin store, read straight from the plugins repository.
 *
 * The same listing the program itself reads — `registry/index.json`, built and
 * committed by that repository's own release job — so a plugin appears here
 * the moment it appears in the program, without anything on this side being
 * told about it.
 *
 * Downloads point at the release assets, which is where the program takes them
 * from too. A file fetched here and dropped on the program's plugin window is
 * the same file by the same digest.
 */

const config = document.currentScript.dataset;
const REPO = config.repo;
const BRANCH = config.branch ?? 'main';

const INDEX = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/registry/index.json`;
const DOWNLOAD = `https://github.com/${REPO}/releases/latest/download`;

/** Whichever language the reader has, falling back the way the program does. */
function text(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const locale = (navigator.language ?? 'en').slice(0, 2);
  return value[locale] ?? value.en ?? Object.values(value)[0] ?? '';
}

/**
 * Where a plugin's cover picture actually lives.
 *
 * The manifest names it `plugin:<author>.<name>/<path>`, which is an address
 * inside the installed plugin — meaningless to a browser. The same file sits
 * in the repository under `plugins/<author>/<name>/`, so that is what a page
 * links to.
 */
function coverOf(plugin) {
  const reference = plugin.cover ?? '';
  const match = /^plugin:([^/]+)\/(.+)$/.exec(reference);
  if (!match) return undefined;

  const [author, ...rest] = match[1].split('.');
  if (!author || rest.length === 0) return undefined;

  return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/plugins/${author}/${rest.join('.')}/${match[2]}`;
}

function readable(bytes) {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} МБ` : `${Math.round(kb)} КБ`;
}

function escape(value) {
  return String(value).replace(/[<>&"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function card(plugin) {
  const cover = coverOf(plugin);
  const name = escape(text(plugin.name) || plugin.id);
  const by = escape(text(plugin.by) || plugin.author || '');
  const about = escape(text(plugin.description));

  return `<li class="plugin">
  ${cover ? `<img class="cover" src="${cover}" alt="" loading="lazy">` : ''}
  <div class="body">
    <h3>${name}</h3>
    <span class="by">${by ? `${by} · ` : ''}${escape(plugin.id)} · ${escape(plugin.version ?? '')}</span>
    <p>${about}</p>
    <div class="foot">
      <span class="size">${readable(plugin.bytes)}</span>
      <a class="get" href="${DOWNLOAD}/${encodeURIComponent(plugin.file)}" download>Скачать</a>
    </div>
  </div>
</li>`;
}

async function fill() {
  const list = document.getElementById('plugins');
  const status = document.getElementById('plugins-status');
  if (!list) return;

  try {
    const response = await fetch(INDEX, { cache: 'no-cache' });
    if (!response.ok) throw new Error(String(response.status));

    const registry = await response.json();
    const plugins = registry.plugins ?? [];

    if (plugins.length === 0) {
      status.textContent = 'В каталоге пока пусто.';
      return;
    }

    list.innerHTML = plugins.map(card).join('');
    status.remove();
  } catch (cause) {
    // A caption rather than an empty page: the catalogue lives in another
    // repository, and "GitHub is not answering" is a different thing from
    // "there are no plugins".
    status.innerHTML =
      `Не удалось прочитать каталог (${escape(cause.message)}). ` +
      `Он лежит <a href="https://github.com/${REPO}">в репозитории плагинов</a>.`;
  }
}

void fill();
