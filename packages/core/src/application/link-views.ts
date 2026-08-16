import type { KeyView } from '@easydeck/engine';
import { drawableIcon } from '@easydeck/engine/icons';

/**
 * Swapping the pictures in a page for links, wherever a page is handed out.
 *
 * Two places hand one out — the answer to `getPageView` and the event that
 * says a deck repainted — and they must agree, because a window applies the
 * event on top of the answer. When only one of them made links, the picture on
 * a key changed address every time it was pushed, and the browser fetched
 * again what it already had.
 */

export interface AssetLinker {
  /** Files the bytes and answers with the path to fetch them from. */
  link(source: string): string;
}

export function linkViews(
  keys: readonly KeyView[],
  assets: AssetLinker | undefined,
): readonly KeyView[] {
  if (!assets) return keys;

  return keys.map((view) => {
    const { backdrop, icon } = view.visual;
    if (!backdrop && !icon) return view;

    return {
      ...view,
      visual: {
        ...view.visual,
        ...(backdrop ? { backdrop: { ...backdrop, source: assets.link(backdrop.source) } } : {}),
        /*
         * A parametric icon is substituted into before it is filed.
         *
         * What travels to a client is a link, and there is nothing to
         * substitute into a link — so the values have to be in the picture by
         * the time it becomes one. Each value is then its own asset with its
         * own address, which is exactly what the immutable cache wants: a
         * needle at 38% is a different picture from the same needle at 39%,
         * and a needle that returns to 38% is fetched from the cache.
         */
        ...(icon ? { icon: { ...icon, source: assets.link(drawableIcon(icon)) } } : {}),
      },
    };
  });
}
