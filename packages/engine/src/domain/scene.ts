/**
 * What the panel should look like, as the engine describes it.
 *
 * Declared here rather than imported from the compositor zone, so the engine
 * stays free of any rendering dependency — the same arrangement `ButtonVisual`
 * has always had. It is structurally compatible with what the compositor
 * accepts, and the daemon, which wires the two together, is where TypeScript
 * catches any drift.
 *
 * The unit is the **region**: a rectangle of keys showing one picture. An
 * ordinary button is a region of one key, which is why merged pictures need no
 * special handling anywhere downstream.
 */

export interface SceneAsset {
  /** Short, stable name for the picture; never the picture itself. */
  readonly id: string;
  /** A path or a data URL, for whoever has to decode it. */
  readonly source: string;
}

export interface SceneImage {
  readonly asset: SceneAsset;
  readonly fit?: 'cover' | 'contain';
}

export interface SceneLabel {
  readonly col: number;
  readonly row: number;
  readonly text: string;
  readonly color?: string;
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly position?: 'top' | 'center' | 'bottom';
}

export interface SceneRegion {
  /** Top-left key of the rectangle, row-major. */
  readonly key: number;
  readonly cols: number;
  readonly rows: number;
  readonly background?: string;
  readonly cornerRadius?: number;
  readonly image?: SceneImage;
  readonly labels?: readonly SceneLabel[];
  /**
   * Keys of this region whose last press ended in an error, as `col,row`.
   *
   * Drawn as a warning sign on top of whatever the key shows, and gone again a
   * few seconds later. A deck has no window to put a message in — the D6 least
   * of all — so the key that failed says so itself, and the alternative is a
   * press that silently does nothing.
   */
  readonly alerts?: readonly { readonly col: number; readonly row: number }[];
}

export interface Scene {
  readonly regions: readonly SceneRegion[];
}

/**
 * A compact identity for a scene, for deciding whether anything changed.
 *
 * Every field except the picture's bytes. Serializing the scene as it stands
 * would put a data URL — a couple of megabytes for one animated icon — into a
 * string built on every repaint, which is to say on every variable change. The
 * old controller did exactly that, and it cost 31ms of blocked event loop per
 * pass on a panel-wide GIF, long after everything was warm.
 */
export function sceneSignature(scene: Scene): string {
  const parts: string[] = [];

  for (const region of scene.regions) {
    parts.push(
      `${region.key}:${region.cols}x${region.rows}`,
      region.image ? `${region.image.asset.id}/${region.image.fit ?? ''}` : '',
      region.background ?? '',
      region.cornerRadius === undefined ? '' : String(region.cornerRadius),
    );

    // The warning sign is part of the picture: leave it out and a key that
    // starts or stops complaining is taken for unchanged and never repainted.
    for (const cell of region.alerts ?? []) parts.push(`!${cell.col},${cell.row}`);

    for (const label of region.labels ?? []) {
      // Serialized rather than joined: label text is whatever the user typed,
      // so any separator can appear inside it.
      parts.push(JSON.stringify([label.col, label.row, label.text, label.color ?? null,
        label.fontFamily ?? null, label.fontSize ?? null, label.position ?? null]));
    }
  }

  return parts.join('');
}

/** Every panel key a scene covers. */
export function sceneKeys(scene: Scene, cols: number): number[] {
  const keys: number[] = [];

  for (const region of scene.regions) {
    const left = region.key % cols;
    const top = Math.floor(region.key / cols);
    for (let row = 0; row < region.rows; row++) {
      for (let col = 0; col < region.cols; col++) keys.push((top + row) * cols + left + col);
    }
  }

  return keys;
}
