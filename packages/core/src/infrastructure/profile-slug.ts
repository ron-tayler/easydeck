/**
 * Turning what a profile is called into what its folder is called.
 *
 * A profile used to carry an `id` inside itself and be filed under it, which
 * meant the folder on disk and the name in the window could say different
 * things — copy `starter.json` to `444.json` and you have a profile called
 * Starter, filed as 444, still identifying itself as `starter`. Three answers
 * to one question is two too many.
 *
 * So the folder is the identity and the name is what a person reads. The
 * folder is derived from the name, transliterated, because a folder called
 * `Стрим` is a folder that travels badly: zip files, git, and a fair number of
 * command-line tools still mangle anything outside ASCII.
 *
 * The derivation is deliberately lossy and never trusted to be unique — that
 * is what `freeName` is for.
 */

/**
 * Cyrillic as it is usually written in Latin letters.
 *
 * Not a standard: BGN/PCGN, ISO 9 and GOST all disagree, and none of them
 * matter here because nothing reads these names back. What matters is that a
 * person seeing `strim-igry` recognises their profile.
 */
const CYRILLIC: Readonly<Record<string, string>> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // The neighbours' letters, which cost two lines and save somebody a folder
  // called `-2`.
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u',
};

/** Combining marks left behind by NFD, so `é` files as `e` rather than `-`. */
const MARKS = /[̀-ͯ]/g;

/** Long enough to stay recognisable, short enough for any path limit. */
const MAX_LENGTH = 48;

/** What a profile with no usable name in it is called. */
const FALLBACK = 'profile';

/**
 * Names Windows refuses to give a folder, whatever the extension.
 *
 * A profile called "Nul" is not a joke somebody is playing — it is a short
 * name that happens to collide with a device from 1981.
 */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/**
 * The folder name a profile of this name wants.
 *
 * Never empty, always safe as a path segment, and never guaranteed free.
 */
export function slugForName(name: string): string {
  const letters = [...name.toLowerCase()]
    .map((character) => CYRILLIC[character] ?? character)
    .join('')
    .normalize('NFD')
    .replace(MARKS, '');

  const slug = letters
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    // A trailing dash left by the length cut reads as a mistake rather than as
    // a truncation.
    .replace(/-+$/, '');

  if (slug === '') return FALLBACK;
  return RESERVED.has(slug) ? `${slug}-${FALLBACK}` : slug;
}

/**
 * The first free folder name for a profile of this name.
 *
 * `keep` is the folder the profile is already in, and it always counts as
 * free: a profile saved twice under an unchanged name must not creep to
 * `stream-2`, `stream-3`, one folder per keystroke.
 *
 * A name that is taken gets a number, which is the whole of the collision
 * handling. Two profiles may genuinely be called "Stream" — one for each
 * game — and refusing the second, or worse, writing over the first, would be
 * answering a question nobody asked.
 */
export async function freeName(
  name: string,
  taken: (candidate: string) => Promise<boolean>,
  keep?: string,
): Promise<string> {
  const base = slugForName(name);

  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (candidate === keep) return candidate;
    if (!(await taken(candidate))) return candidate;
  }

  throw new Error(`Too many profiles named like '${base}'`);
}
