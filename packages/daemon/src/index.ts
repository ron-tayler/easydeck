/**
 * @easydeck/daemon — the composition root.
 *
 * The only place that knows about every other zone at once: it opens a
 * surface from @easydeck/device, builds a renderer from @easydeck/renderer,
 * and hands both to @easydeck/engine through the adapters below.
 *
 * Still to come (milestone 3): the WebSocket API for the configurator,
 * profile persistence, built-in actions that touch the OS, and autostart.
 */

export { toSurfacePort } from './infrastructure/surface-adapter.js';
export { toKeyRendererPort } from './infrastructure/renderer-adapter.js';
export { startDeck } from './start-deck.js';
export type { RunningDeck, StartDeckOptions } from './start-deck.js';
