import { GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Font resolution for the canvas rasterizer.
 *
 * Two problems this solves:
 *   1. Skia does not understand the generic CSS families (`sans-serif` and
 *      friends) — asking for one silently renders nothing.
 *   2. System fonts differ per machine, so the same profile would look
 *      different on Windows, Linux and macOS, and a headless Linux box may
 *      have no fonts at all.
 *
 * So we bundle DejaVu (permissively licensed, wide Latin/Cyrillic/Greek
 * coverage) as the deterministic default, while still allowing a profile to
 * name any installed system font. Resolution always appends the bundled font
 * as a fallback, so missing glyphs still render.
 */

const BUNDLED = {
  'sans-serif': { alias: 'EasyDeck Sans', file: 'DejaVuSans.ttf' },
  serif: { alias: 'EasyDeck Serif', file: 'DejaVuSerif.ttf' },
  monospace: { alias: 'EasyDeck Mono', file: 'DejaVuSansMono.ttf' },
} as const;

export type GenericFamily = keyof typeof BUNDLED;

export const DEFAULT_FONT_FAMILY: GenericFamily = 'sans-serif';

let registered = false;

/**
 * Where a font file really is, for something that opens it itself.
 *
 * In a packaged Electron app the zones live inside `app.asar`, and everything
 * that goes through Node reads out of it as if it were a folder. Skia does
 * not: it takes the path down to the operating system, which knows of no such
 * folder — so the font silently fails to register, `resolveFontFamily` hands
 * back a family nobody has, and the panel draws every label as nothing at all.
 *
 * The packager is told to leave these three files on disk beside the archive,
 * and this is the half that points at them. Exported for the test, and taking
 * its own existence check so that the test needs no archive to run.
 */
export function fontPathOnDisk(path: string, exists: (candidate: string) => boolean = existsSync): string {
  if (!path.includes('app.asar')) return path;

  const unpacked = path.replace('app.asar', 'app.asar.unpacked');
  return exists(unpacked) ? unpacked : path;
}

/** Registers the bundled fonts with Skia. Idempotent and safe to call often. */
export function ensureFontsRegistered(): void {
  if (registered) return;
  registered = true;

  const require = createRequire(import.meta.url);
  let fontDir: string;
  try {
    fontDir = require.resolve('dejavu-fonts-ttf/package.json').replace(/package\.json$/, 'ttf/');
  } catch {
    console.error('EasyDeck: шрифты DejaVu не найдены; подписи на панели будут рисоваться системным шрифтом или не рисоваться вовсе');
    return; // fall back to system fonts only
  }

  let landed = 0;
  for (const { alias, file } of Object.values(BUNDLED)) {
    try {
      // The call answers with a font key, or with null when Skia would not
      // take the file — it does not throw. That is how this went unnoticed for
      // a whole release: a `catch` sees nothing wrong with a font that never
      // registered, and the failure had no other voice.
      if (GlobalFonts.registerFromPath(fontPathOnDisk(fontDir + file), alias)) landed += 1;
    } catch {
      // A single missing bundled font is not fatal; the others may cover it.
    }
  }

  // Said out loud, because the symptom is labels going blank on a device
  // nobody can attach a debugger to, while the same text renders perfectly in
  // the window a foot away.
  if (landed === 0) {
    console.error(`EasyDeck: ни один шрифт не зарегистрирован из ${fontDir}; подписи на панели останутся пустыми`);
  }
}

/**
 * Turns a requested family into a canvas font-family list.
 *
 * Generic keywords map to the bundled fonts; a concrete family is used only
 * if it is actually installed. Either way the bundled sans is appended as the
 * last resort so text never silently disappears.
 */
export function resolveFontFamily(requested: string | undefined): string {
  ensureFontsRegistered();

  const fallback = quote(BUNDLED[DEFAULT_FONT_FAMILY].alias);
  const family = requested?.trim();
  if (!family) return fallback;

  const generic = family.toLowerCase() as GenericFamily;
  if (generic in BUNDLED) {
    const alias = quote(BUNDLED[generic].alias);
    return alias === fallback ? alias : `${alias}, ${fallback}`;
  }

  if (GlobalFonts.has(family)) return `${quote(family)}, ${fallback}`;
  return fallback;
}

function quote(family: string): string {
  return `"${family}"`;
}
