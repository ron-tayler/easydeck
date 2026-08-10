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

/**
 * The longest side a stored picture keeps.
 *
 * Generous next to a single key, because a picture may be stretched across a
 * rectangle of them — three keys wide is over three hundred pixels — and a
 * picture saved at key size would be soft there. Still small enough that a
 * photograph of several megabytes lands in the profile as tens of kilobytes.
 */
const MAX_SIDE = 512;

/** Roughly a megabyte of base64. Past that a profile stops being editable. */
export const LARGE_IMAGE_BYTES = 700_000;

export function isAnimated(source: string): boolean {
  return source.startsWith('data:image/gif');
}

/**
 * Redraws a picture smaller, keeping its shape.
 *
 * Its shape, and nothing else. This used to letterbox everything into a square
 * — bars baked into the picture itself — so a wide photograph arrived on the
 * key already surrounded by empty space, and cropping it at draw time had
 * nothing left to crop. What the key does with the shape is decided when it is
 * drawn, where it can still be undone.
 */
async function drawToPng(image: CanvasImageSource, width: number, height: number): Promise<string> {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

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
  // upscaled 24px sprite. Library icons are square, so nothing is cropped from
  // them when the key draws them edge to edge.
  return drawToPng(image, KEY_SIZE, KEY_SIZE);
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
 * a GIF is asking for. Everything else is scaled down but not reshaped, which
 * usually turns a photo of several megabytes into a few tens of kilobytes.
 */
export async function fileIconSource(file: File): Promise<string> {
  const source = await readAsDataUrl(file);
  if (isAnimated(source)) return source;

  const image = await loadImage(source);
  return drawToPng(image, image.width, image.height);
}
