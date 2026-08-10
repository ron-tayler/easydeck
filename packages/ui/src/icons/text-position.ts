/**
 * The three places a label can sit, drawn as the key itself.
 *
 * A picture rather than the words "top / centre / bottom": the choice is about
 * where something lands, and a small square with a bar in it says that faster
 * than a dropdown does — and in any language.
 *
 * `currentColor` throughout, so the same file is black on a light theme and
 * white on a dark one without a second copy of each icon.
 */

export type TextPosition = 'top' | 'center' | 'bottom';

const BAR_Y: Readonly<Record<TextPosition, number>> = {
  top: 4,
  center: 12,
  bottom: 20,
};

export const TEXT_POSITIONS: readonly TextPosition[] = ['top', 'center', 'bottom'];

export function textPositionIcon(position: TextPosition): string {
  return [
    '<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">',
    '<rect x="1" y="1" width="30" height="30" rx="5" stroke="currentColor" stroke-width="2"/>',
    `<rect x="4" y="${BAR_Y[position]}" width="24" height="8" rx="2" fill="currentColor"/>`,
    '</svg>',
  ].join('');
}
