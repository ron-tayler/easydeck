import type { Scene, SceneRegion } from '../domain/scene.js';
import type { PresenterPort } from './ports/presenter-port.js';

/**
 * A presenter that behaves like the real one where it matters to the engine.
 *
 * Two behaviours are modelled rather than stubbed, because the controller's
 * tests are about them: a scene is laid out per key, and only the keys whose
 * appearance actually changed are written. A fake that wrote everything on
 * every pass would agree with any controller at all, including one that
 * repainted the whole panel on every variable change.
 *
 * Not a test file itself, so it is compiled but never run; it is deliberately
 * absent from the package's exports.
 */
export class FakePresenter implements PresenterPort {
  readonly writes: Array<{ key: number; text: string }> = [];
  readonly cleared: number[] = [];
  readonly scenes: Scene[] = [];

  /** What each key shows, in the readable form assertions are written in. */
  private readonly shown = new Map<number, string>();
  private readonly downListeners = new Set<(key: number) => void>();
  private readonly upListeners = new Set<(key: number) => void>();

  constructor(readonly layout: { rows: number; cols: number } = { rows: 1, cols: 3 }) {}

  onKeyDown(listener: (key: number) => void): () => void {
    this.downListeners.add(listener);
    return () => this.downListeners.delete(listener);
  }

  onKeyUp(listener: (key: number) => void): () => void {
    this.upListeners.add(listener);
    return () => this.upListeners.delete(listener);
  }

  async present(scene: Scene): Promise<void> {
    this.scenes.push(scene);

    const next = new Map<number, string>();
    for (const region of scene.regions) {
      for (const [key, text] of this.textOf(region)) next.set(key, text);
    }

    for (const [key, text] of next) {
      if (this.shown.get(key) === text) continue;
      this.writes.push({ key, text });
    }

    for (const key of this.shown.keys()) {
      if (!next.has(key)) this.cleared.push(key);
    }

    this.shown.clear();
    for (const [key, text] of next) this.shown.set(key, text);
  }

  press(key: number): void {
    for (const listener of this.downListeners) listener(key);
  }

  release(key: number): void {
    for (const listener of this.upListeners) listener(key);
  }

  lastText(key: number): string | undefined {
    return [...this.writes].reverse().find((write) => write.key === key)?.text;
  }

  /** The scene last handed over, for tests about regions rather than keys. */
  get scene(): Scene | undefined {
    return this.scenes[this.scenes.length - 1];
  }

  regionCovering(key: number): SceneRegion | undefined {
    return this.scene?.regions.find((region) =>
      [...this.textOf(region).keys()].includes(key),
    );
  }

  /** `background|label` per key of a region — the form the assertions use. */
  private textOf(region: SceneRegion): Map<number, string> {
    const left = region.key % this.layout.cols;
    const top = Math.floor(region.key / this.layout.cols);
    const texts = new Map<number, string>();

    for (let row = 0; row < region.rows; row++) {
      for (let col = 0; col < region.cols; col++) {
        const label = region.labels?.find((entry) => entry.col === col && entry.row === row);
        texts.set(
          (top + row) * this.layout.cols + left + col,
          `${region.background ?? '-'}|${label?.text ?? '-'}`,
        );
      }
    }

    return texts;
  }
}

/** A presenter that accepts everything and remembers nothing. */
export function silentPresenter(rows: number, cols: number): PresenterPort {
  return {
    layout: { rows, cols },
    onKeyDown: () => () => {},
    onKeyUp: () => () => {},
    present: async () => {},
  };
}
