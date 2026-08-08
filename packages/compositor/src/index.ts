/**
 * @easydeck/compositor — the panel as it should look, held in memory.
 *
 * The engine hands over a `Scene`: regions of keys, each showing one picture.
 * What reaches the hardware — which key gets which slice, in what order, and
 * how often — is decided here.
 *
 * Two things drive the design, both measured rather than assumed.
 *
 * A picture stretched over N keys must be composed **once** and cut N times,
 * not drawn N times. And the panel swallows about 233 images a second, which a
 * 30fps picture across fifteen keys exceeds twice over — so playback is
 * budgeted against the hardware instead of queued at it.
 */

export type { AssetId, AssetRef } from './domain/asset.js';
export { CompositorError, InvalidSceneError } from './domain/errors.js';
export { regionKey, tileKey } from './domain/keys.js';
export type { PanelFormat, RegionGeometry } from './domain/panel-format.js';
export { columnOf, keyCount, regionGeometry, rowOf, tileOrigin } from './domain/panel-format.js';
export type { Scene, SceneImage, SceneLabel, SceneRegion } from './domain/scene.js';
export {
  EMPTY_SCENE,
  cellOf,
  cornersOf,
  labelAt,
  regionKeys,
  validateScene,
} from './domain/scene.js';

export type { PlannedRegion, PlannedTile, ScenePlan } from './application/scene-plan.js';
export { needsWork, planScene } from './application/scene-plan.js';

export { PanelCompositor } from './application/panel-compositor.js';
export type {
  PanelCompositorEvents,
  PanelCompositorOptions,
} from './application/panel-compositor.js';
export { PanelState } from './application/panel-state.js';
export type { PanelTile } from './application/panel-state.js';
export { ByteCache } from './application/byte-cache.js';
export { WriteBudget } from './application/write-budget.js';
export { digest } from './domain/digest.js';

export type {
  ComposedRegion,
  ComposerPort,
  CutTileRequest,
  FrameSource,
  OpenRequest,
  ShrinkTileRequest,
  TileBitmap,
  TileCorners,
  TileLabel,
} from './application/ports/composer-port.js';
export type { EncodedTile, EncodeRequest, EncoderPort } from './application/ports/encoder-port.js';
export type { PanelPort } from './application/ports/panel-port.js';
export { DEFAULT_WRITES_PER_SECOND } from './application/ports/panel-port.js';
export type { ClockPort, TimerHandle } from './application/ports/clock-port.js';
export { systemClock } from './application/ports/clock-port.js';
