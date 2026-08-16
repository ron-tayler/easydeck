/**
 * The download button, pointed at whatever this machine can actually run.
 *
 * The releases are the only place that knows what exists, so this asks them
 * rather than guessing a file name — a release whose installer was renamed
 * would otherwise hand out a link to nothing.
 *
 * Everything degrades to the releases page. GitHub's unauthenticated API
 * allows sixty calls an hour per address, this page is not important enough to
 * carry a token, and "the button did nothing" is a worse outcome than one
 * extra click.
 */

const REPO = document.currentScript.dataset.repo;
const RELEASES = `https://github.com/${REPO}/releases`;

/**
 * Whether this Mac is Apple silicon, as far as a browser will say.
 *
 * It will not say directly: the user agent claims Intel on every Mac made
 * since. The graphics adapter does say, and names itself "Apple M…" — which is
 * a probe rather than a fact, so an answer of "no idea" is a real answer and
 * gets the Intel build. That one runs on both machines through Rosetta, where
 * guessing the other way round hands an Apple binary to a Mac that cannot open
 * it.
 */
function appleSilicon() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    return /apple\s+m\d|apple gpu/i.test(renderer);
  } catch {
    return false;
  }
}

/**
 * Which installer belongs to whoever is reading.
 *
 * Each platform lists its file endings in order of preference, because a
 * release carries several: matching a bare `.dmg` first would hand an Apple
 * silicon build to an Intel Mac simply because it was uploaded earlier.
 */
function platformOf() {
  const hint = navigator.userAgentData?.platform ?? '';
  const agent = `${hint} ${navigator.userAgent}`.toLowerCase();

  if (agent.includes('win')) {
    return { name: 'Windows', endings: ['setup.exe', '.exe'] };
  }

  if (agent.includes('mac') || agent.includes('darwin')) {
    const arm = appleSilicon();
    return {
      name: 'macOS',
      endings: arm ? ['arm64.dmg', '.dmg'] : ['x64.dmg', '.dmg'],
      also: arm ? ['x64.dmg', 'Intel'] : ['arm64.dmg', 'Apple silicon'],
    };
  }

  if (agent.includes('linux') || agent.includes('x11')) {
    return { name: 'Linux', endings: ['.appimage', '.deb'], also: ['.deb', 'пакет .deb'] };
  }

  return undefined;
}

function readable(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} МБ` : `${Math.round(bytes / 1024)} КБ`;
}

/** The newest release worth offering, prereleases included. */
async function newest() {
  /*
   * Deliberately not `/releases/latest`.
   *
   * That endpoint leaves out prereleases and answers 404 when there are only
   * those — so a project whose first tag is an `-rc` looked to this page like
   * a project with no installers at all, while seven of them sat in the
   * release. A prerelease is what this program has, and hiding it would be
   * hiding the whole download.
   */
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(String(response.status));

  const releases = await response.json();
  return releases.find((release) => !release.draft);
}

function pick(assets, endings) {
  for (const ending of endings) {
    const found = assets.find((asset) => asset.name.toLowerCase().endsWith(ending.toLowerCase()));
    if (found) return found;
  }
  return undefined;
}

async function fill() {
  const button = document.getElementById('download');
  const note = document.getElementById('download-note');
  if (!button) return;

  const platform = platformOf();
  if (platform) button.textContent = `Скачать для ${platform.name}`;

  let release;
  try {
    release = await newest();
  } catch {
    button.href = RELEASES;
    button.textContent = 'Открыть страницу релизов';
    if (note) note.innerHTML = `Список версий — <a href="${RELEASES}">на GitHub</a>.`;
    return;
  }

  if (!release) {
    // The ordinary state of a project that has not tagged anything, and saying
    // so is more honest than a button that 404s.
    button.href = RELEASES;
    button.textContent = 'Открыть страницу релизов';
    if (note) note.textContent = 'Собранных установщиков пока нет — программу можно собрать из исходников.';
    return;
  }

  const assets = release.assets ?? [];
  const asset = platform ? pick(assets, platform.endings) : undefined;

  if (!asset) {
    button.href = release.html_url ?? RELEASES;
    button.textContent = 'Выбрать установщик';
    if (note) note.innerHTML = `${release.tag_name} — <a href="${RELEASES}">все файлы</a>.`;
    return;
  }

  button.href = asset.browser_download_url;

  if (note) {
    const parts = [release.tag_name, readable(asset.size)];
    // Said on the tin rather than discovered after installing.
    if (release.prerelease) parts.push('предварительная версия');

    const other = platform.also ? pick(assets, [platform.also[0]]) : undefined;
    if (other) parts.push(`<a href="${other.browser_download_url}">${platform.also[1]}</a>`);
    parts.push(`<a href="${RELEASES}">другие платформы</a>`);

    note.innerHTML = parts.join(' · ');
  }
}

void fill();
