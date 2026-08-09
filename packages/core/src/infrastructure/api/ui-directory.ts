import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Where the built configurator lives, if it was built.
 *
 * Resolved through the package rather than by walking up from here, so it
 * works the same whether the daemon runs from a checkout, from an installed
 * dependency, or from inside the desktop app's bundle.
 *
 * Returns undefined when the interface has not been built. That is a normal
 * state — a fresh checkout, a headless install — and the daemon serves its API
 * regardless; only the page is missing.
 */
export function findUiDirectory(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve('@easydeck/ui/package.json')), 'dist');
  } catch {
    return undefined;
  }
}
