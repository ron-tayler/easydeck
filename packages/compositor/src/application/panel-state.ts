/**
 * The panel as it physically is: what is on each key, right now.
 *
 * This is the "device simulated in memory" the whole zone is built around, and
 * it earns its place three times over.
 *
 * It is what scenes are planned against, so a key that never received its
 * write is retried rather than assumed painted. It lets a reconnected device
 * be refilled from bytes we already have, with nothing decoded or encoded
 * again. And it makes a write skippable: a tile identical to the one already
 * on the key is bus time spent on nothing, and bus time is the scarce thing.
 */
export interface PanelTile {
  /** Which configuration this tile came from — the scene-planning identity. */
  readonly tileKey: string;
  /** Which frame of it, so an animated key can tell its own frames apart. */
  readonly frameIndex: number;
  readonly bytes: Uint8Array;
}

export class PanelState {
  private readonly tiles = new Map<number, PanelTile>();

  get size(): number {
    return this.tiles.size;
  }

  get(key: number): PanelTile | undefined {
    return this.tiles.get(key);
  }

  /** Whether writing this exact tile would change anything. */
  holds(key: number, tileKey: string, frameIndex: number): boolean {
    const tile = this.tiles.get(key);
    return tile?.tileKey === tileKey && tile.frameIndex === frameIndex;
  }

  set(key: number, tile: PanelTile): void {
    this.tiles.set(key, tile);
  }

  clear(key: number): void {
    this.tiles.delete(key);
  }

  clearAll(): void {
    this.tiles.clear();
  }

  /** What each key holds, for planning the next scene against. */
  tileKeys(): ReadonlyMap<number, string> {
    const keys = new Map<number, string>();
    for (const [key, tile] of this.tiles) keys.set(key, tile.tileKey);
    return keys;
  }

  /** Everything needed to refill a panel that went away and came back. */
  entries(): readonly [number, PanelTile][] {
    return [...this.tiles.entries()].sort((a, b) => a[0] - b[0]);
  }
}
