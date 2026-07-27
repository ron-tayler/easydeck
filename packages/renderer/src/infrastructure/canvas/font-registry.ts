import { GlobalFonts } from '@napi-rs/canvas';
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

/** Registers the bundled fonts with Skia. Idempotent and safe to call often. */
export function ensureFontsRegistered(): void {
  if (registered) return;
  registered = true;

  const require = createRequire(import.meta.url);
  let fontDir: string;
  try {
    fontDir = require.resolve('dejavu-fonts-ttf/package.json').replace(/package\.json$/, 'ttf/');
  } catch {
    return; // fall back to system fonts only
  }

  for (const { alias, file } of Object.values(BUNDLED)) {
    try {
      GlobalFonts.registerFromPath(fontDir + file, alias);
    } catch {
      // A missing bundled font is not fatal; system fonts may still cover it.
    }
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
