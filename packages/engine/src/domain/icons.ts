/**
 * Everything about a key's picture, from one door.
 *
 * Three modules behind it, and the split is the point: parameters answer to
 * variables, colours are chosen by hand, and one of them puts the two together
 * into something to draw. Whoever draws a key wants all three and should not
 * have to know which is which to import them.
 */

export type { IconParam, IconBinding } from './icon-params.js';
export {
  applyIconParams,
  easydeckMetadata,
  iconParamsProblem,
  readIconParams,
  resolveIconParams,
  svgSourceOf,
  svgTextOf,
} from './icon-params.js';

export type { IconColorSlot } from './icon-colors.js';
export {
  iconPaletteProblem,
  readIconPalette,
  resolveIconColors,
  usesCurrentColor,
  withRootColor,
} from './icon-colors.js';

export type { DrawableIcon } from './icon-source.js';
export { drawableIcon } from './icon-source.js';
