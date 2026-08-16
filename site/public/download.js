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

/** Which installer belongs to whoever is reading, as far as a browser knows. */
function platformOf() {
  const hint = navigator.userAgentData?.platform ?? '';
  const agent = `${hint} ${navigator.userAgent}`.toLowerCase();

  if (agent.includes('win')) return { id: 'windows', name: 'Windows', endings: ['.exe'] };
  if (agent.includes('mac') || agent.includes('darwin')) {
    // Apple silicon and Intel are separate builds; the arm one is named for it.
    const arm = agent.includes('arm') || navigator.maxTouchPoints > 1;
    return { id: 'mac', name: 'macOS', endings: arm ? ['arm64.dmg', '.dmg'] : ['.dmg'] };
  }
  if (agent.includes('linux') || agent.includes('x11')) {
    return { id: 'linux', name: 'Linux', endings: ['.appimage', '.deb'] };
  }
  return undefined;
}

function readable(bytes) {
  if (!bytes) return '';
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
}

async function fill() {
  const button = document.getElementById('download');
  const note = document.getElementById('download-note');
  if (!button) return;

  const platform = platformOf();
  if (platform) button.textContent = `Скачать для ${platform.name}`;

  let release;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(String(response.status));
    release = await response.json();
  } catch {
    /*
     * No release yet, or the API said no.
     *
     * The first is the ordinary state of a project that has not tagged
     * anything, and saying so is more honest than a button that 404s.
     */
    button.href = RELEASES;
    button.textContent = 'Открыть страницу релизов';
    if (note) {
      note.textContent = 'Собранных установщиков пока нет — программу можно собрать из исходников.';
    }
    return;
  }

  const assets = release.assets ?? [];
  const asset = platform
    ? platform.endings
        .map((ending) => assets.find((one) => one.name.toLowerCase().endsWith(ending)))
        .find(Boolean)
    : undefined;

  if (asset) {
    button.href = asset.browser_download_url;
    button.textContent = `Скачать для ${platform.name}`;
    if (note) {
      note.innerHTML =
        `${release.tag_name} · ${readable(asset.size)} · ` +
        `<a href="${RELEASES}">другие платформы</a>`;
    }
  } else {
    button.href = release.html_url ?? RELEASES;
    button.textContent = 'Выбрать установщик';
    if (note) note.textContent = `${release.tag_name} — установщика для этой системы в релизе нет.`;
  }
}

void fill();
