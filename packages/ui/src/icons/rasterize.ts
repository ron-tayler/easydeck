import { iconSvg } from './library.js';
import type { LibraryIcon } from './library.js';

/**
 * Turns a chosen picture into something a profile can carry.
 *
 * Images are embedded as data URLs rather than referenced by path. A profile
 * is a JSON document that gets copied between machines, and buttons are copied
 * between pages through the clipboard as JSON — a file reference would survive
 * neither. The cost is profile size, which is why everything is scaled down to
 * the key first.
 */

/** The device's own key size: anything larger is detail the panel cannot show. */
const KEY_SIZE = 112;

/** Roughly a megabyte of base64. Past that a profile stops being editable. */
export const LARGE_IMAGE_BYTES = 700_000;

export function isAnimated(source: string): boolean {
  return source.startsWith('data:image/gif');
}

async function drawToPng(image: CanvasImageSource, width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = KEY_SIZE;
  canvas.height = KEY_SIZE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  // Contain rather than cover: cropping someone's picture without being asked
  // is a worse default than leaving space around it.
  const scale = Math.min(KEY_SIZE / width, KEY_SIZE / height);
  const w = width * scale;
  const h = height * scale;
  ctx.drawImage(image, (KEY_SIZE - w) / 2, (KEY_SIZE - h) / 2, w, h);

  return canvas.toDataURL('image/png');
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read the image'));
    image.src = source;
  });
}

/** Rasterizes a library icon at key size, in the colour it will be drawn in. */
export async function libraryIconSource(icon: LibraryIcon, color: string): Promise<string> {
  const svg = iconSvg(icon, color);
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const image = await loadImage(url);

  // Drawn at key size from vector art, so the icon is crisp rather than an
  // upscaled 24px sprite.
  return drawToPng(image, image.width || 24, image.height || 24);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/**
 * A picture the user picked from disk.
 *
 * A GIF is passed through untouched: redrawing it here would keep the first
 * frame and throw the animation away, which is the one thing someone choosing
 * a GIF is asking for. Everything else is scaled to the key, which usually
 * turns a photo of several megabytes into a few tens of kilobytes.
 */
export async function fileIconSource(file: File): Promise<string> {
  const source = await readAsDataUrl(file);
  if (isAnimated(source)) return source;

  const image = await loadImage(source);
  return drawToPng(image, image.width, image.height);
}
