import { EventEmitter } from 'node:events';

import type { ActionContext, ActionDescriptor, ButtonEvent } from '../domain/action.js';
import { EngineError } from '../domain/errors.js';
import type {
  ButtonDefinition,
  ButtonStateDefinition,
  DeckLocation,
  FolderDefinition,
  PageDefinition,
  ProfileDefinition,
} from '../domain/profile.js';
import { ProfileTree } from '../domain/profile-tree.js';
import { sceneKeys, sceneSignature } from '../domain/scene.js';
import type { Scene, SceneLabel, SceneRegion } from '../domain/scene.js';
import { renderTemplate } from '../domain/template.js';
import { validateProfile } from '../domain/validate-profile.js';
import {
  VariableStore,
  inferVariableType,
  initialVariableValue,
  isTruthy,
} from '../domain/variables.js';
import type { VariableDeclaration, VariableValue } from '../domain/variables.js';
import type { BackdropSlice, ButtonVisual } from '../domain/visual.js';
import type { ActionRegistry } from './action-registry.js';
import { AssetIds } from './asset-ids.js';
import { systemClock } from './ports/clock-port.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';
import type { PresenterPort } from './ports/presenter-port.js';

/** What a single key shows right now, with everything already resolved. */
export interface KeyView {
  readonly key: number;
  readonly buttonId: string;
  readonly stateId: string;
  readonly visual: ButtonVisual;
}

export interface DeckControllerOptions {
  /** How long a key must be held before `longPress` fires. */
  readonly longPressMs?: number;
  readonly clock?: ClockPort;
  /** How many locations `goBack` can retrace. */
  readonly historyLimit?: number;
}

export interface DeckControllerEvents {
  /** Something failed in a way that should not stop the deck. */
  error: [error: Error];
  locationChanged: [location: DeckLocation];
  /** Emitted after every repaint pass, with the keys actually written. */
  painted: [keys: number[]];
}

const DEFAULT_LONG_PRESS_MS = 500;
const DEFAULT_HISTORY_LIMIT = 32;

/**
 * Runs a profile on a panel: presses in, actions and scenes out.
 *
 * Repainting works by re-resolving every button on the current page and
 * describing the result as a scene. That is cheaper than it sounds for fifteen
 * keys, and it removes a whole class of bugs that a variable-to-button
 * dependency map invites — a key can never be left showing a stale value
 * because some dependency was not recorded.
 *
 * What the controller deliberately does not do is decide what reaches the
 * hardware. It says how the panel should look; slicing pictures, caching
 * tiles, pacing animation against the bus and skipping writes belong to the
 * presenter, which can see the whole panel at once and measure what it does.
 */
export class DeckController extends EventEmitter<DeckControllerEvents> {
  readonly variables = new VariableStore();

  private profile?: ProfileDefinition;
  private tree?: ProfileTree;
  private location?: DeckLocation;
  /** Visited locations, most recent last, for `goBack`. */
  private readonly history: DeckLocation[] = [];
  /** Explicit state overrides, for buttons not bound to a variable. */
  private readonly stateOverrides = new Map<string, string>();
  /** Declared variables by name: the profile's, plus every plugin's. */
  private declarations = new Map<string, VariableDeclaration>();
  /** Short names for pictures, so no scene ever carries their bytes around. */
  private readonly assets = new AssetIds();
  /** Signature of the scene last presented, for change detection. */
  private lastScene?: string;
  private readonly pressTimers = new Map<number, TimerHandle>();
  private readonly longPressed = new Set<number>();

  private readonly unsubscribe: Array<() => void> = [];
  private running = false;
  /** Serializes repaints so two rapid presses cannot interleave writes. */
  private paintChain: Promise<unknown> = Promise.resolve();
  private paintQueued = false;

  private readonly longPressMs: number;
  private readonly historyLimit: number;
  private readonly clock: ClockPort;

  constructor(
    private readonly surface: PresenterPort,
    private readonly actions: ActionRegistry,
    options: DeckControllerOptions = {},
  ) {
    super();
    this.longPressMs = options.longPressMs ?? DEFAULT_LONG_PRESS_MS;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.clock = options.clock ?? systemClock;
  }

  get currentLocation(): DeckLocation | undefined {
    return this.location;
  }

  get profileId(): string | undefined {
    return this.profile?.id;
  }

  /** Root first, current folder last — the breadcrumb a UI shows. */
  get folderPath(): FolderDefinition[] {
    if (!this.tree || !this.location) return [];
    return this.tree.pathTo(this.location.folderId);
  }

  /** Pages of the folder the deck is in, in author order. */
  get currentFolderPages(): readonly PageDefinition[] {
    if (!this.tree || !this.location) return [];
    return this.tree.folder(this.location.folderId)?.pages ?? [];
  }

  /** Validates and installs a profile. Does not paint until `start`. */
  load(profile: ProfileDefinition): void {
    validateProfile(profile);

    const { rows, cols } = this.surface.layout;
    if (profile.layout.rows !== rows || profile.layout.cols !== cols) {
      throw new EngineError(
        `Profile '${profile.id}' is authored for ${profile.layout.rows}x${profile.layout.cols}, ` +
          `but the surface is ${rows}x${cols}`,
      );
    }

    this.profile = profile;
    this.tree = new ProfileTree(profile);
    this.stateOverrides.clear();
    this.history.length = 0;
    // Names are dropped with the profile that needed them: the map is keyed on
    // the source strings themselves, and holding a replaced profile's data
    // URLs would keep megabytes alive for pictures nothing refers to any more.
    this.assets.clear();
    this.markAllDirty();
    this.location = this.initialLocation(profile, this.tree);

    /*
     * Plugin declarations first, then the profile's, so a profile can restate
     * a plugin variable — to give it a starting value — without being able to
     * take it over: the name still belongs to the plugin, and so does the type
     * that everything else reasons about.
     */
    this.declarations = new Map();
    for (const declaration of this.actions.variables()) {
      this.declarations.set(declaration.name, declaration);
    }
    for (const declaration of profile.variables ?? []) {
      const owner = this.declarations.get(declaration.name);
      this.declarations.set(
        declaration.name,
        owner?.pluginId ? { ...declaration, type: owner.type, pluginId: owner.pluginId } : declaration,
      );
    }

    /*
     * Seeding is not the same as overwriting. A profile reloaded because its
     * file changed keeps whatever its variables have grown into; only names
     * with no value yet get one, which is what makes a declared variable
     * usable before anything has written to it.
     */
    for (const declaration of this.declarations.values()) {
      if (!this.variables.has(declaration.name)) {
        this.variables.set(declaration.name, initialVariableValue(declaration));
      }
    }
  }

  /** Every declared variable, for a configurator to offer and edit. */
  get variableDeclarations(): readonly VariableDeclaration[] {
    return [...this.declarations.values()];
  }

  /** Subscribes to the surface and paints the current page. */
  async start(): Promise<void> {
    if (this.running) return;
    if (!this.profile) throw new EngineError('No profile loaded');
    this.running = true;

    this.unsubscribe.push(
      this.surface.onKeyDown((key) => this.handleKeyDown(key)),
      this.surface.onKeyUp((key) => this.handleKeyUp(key)),
      // Any variable change may alter a label or a bound state.
      this.variables.onChange(() => this.requestPaint()),
    );

    await this.paint();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    for (const off of this.unsubscribe.splice(0)) off();
    for (const handle of this.pressTimers.values()) this.clock.clearTimeout(handle);
    this.pressTimers.clear();
    this.longPressed.clear();

    await this.paintChain.catch(() => undefined);
  }

  // --- navigation --------------------------------------------------------

  openFolder(folderId: string): void {
    const tree = this.requireTree();
    const folder = tree.folder(folderId);
    if (!folder) throw new EngineError(`No folder '${folderId}' in profile '${this.profile!.id}'`);

    const page = folder.pages[0];
    if (!page) throw new EngineError(`Folder '${folderId}' has no pages`);

    this.moveTo({ folderId, pageId: page.id });
  }

  /** Any page is reachable, not only a sibling — the folder follows the page. */
  goToPage(pageId: string): void {
    const tree = this.requireTree();
    const owner = tree.ownerOf(pageId);
    if (!owner) throw new EngineError(`No page '${pageId}' in profile '${this.profile!.id}'`);

    this.moveTo({ folderId: owner.id, pageId });
  }

  goUp(): void {
    const tree = this.requireTree();
    if (!this.location) return;

    const parent = tree.parentOf(this.location.folderId);
    // At the root there is nowhere to go, and that is not an error: a button
    // labelled "back" should be harmless on the top level, not throw.
    if (parent) this.openFolder(parent.id);
  }

  goHome(): void {
    this.openFolder(this.requireTree().root.id);
  }

  goBack(): void {
    const previous = this.history.pop();
    if (!previous) return;

    // Popped rather than pushed again, so repeated presses walk backwards
    // instead of bouncing between two locations.
    this.location = previous;
    this.emit('locationChanged', previous);
    this.requestPaint();
  }

  setButtonState(buttonId: string, stateId: string): void {
    const button = this.findButton(buttonId);
    if (!button) throw new EngineError(`No button '${buttonId}' on the current page`);
    if (!button.states.some((state) => state.id === stateId)) {
      throw new EngineError(`Button '${buttonId}' has no state '${stateId}'`);
    }

    // A bound button takes its state from the variable, so write that instead
    // — otherwise the override and the variable would disagree.
    if (button.stateFrom) {
      const state = button.states.find((candidate) => candidate.id === stateId)!;
      this.variables.set(button.stateFrom, this.valueSelecting(button, state, button.stateFrom));
    } else {
      this.stateOverrides.set(buttonId, stateId);
    }

    this.requestPaint();
  }

  /**
   * The current page with every button resolved: its active state and the
   * visual after variable substitution.
   *
   * Exposed so a configurator can mirror the panel without reimplementing
   * state binding and templating — the two things most likely to drift
   * between an engine and a UI that each resolve them separately.
   */
  view(): KeyView[] {
    const page = this.currentPage;
    if (!page) return [];

    /*
     * Walks keys rather than buttons, because a merged picture reaches keys
     * that hold no button of their own. Those are reported under the merged
     * button's identity — it is the one that put something there.
     */
    const { rows, cols } = this.surface.layout;
    const views: KeyView[] = [];

    for (let key = 0; key < rows * cols; key++) {
      const visual = this.visualForKey(key);
      if (!visual) continue;

      const owner = this.buttonAt(key) ?? this.spanCovering(key)?.parent;
      if (!owner) continue;

      views.push({
        key,
        buttonId: owner.id,
        stateId: this.resolveState(owner).id,
        visual,
      });
    }

    return views;
  }

  /** Forces every key to be rewritten on the next pass. */
  invalidate(): void {
    this.markAllDirty();
    this.requestPaint();
  }

  /**
   * Forces the next pass to hand the scene over rather than recognise it as
   * unchanged.
   *
   * Only the engine's own memory of what it last said is dropped. What is
   * physically on the panel is the presenter's business, and it compares
   * against the real thing — so a key that lost its picture is repainted even
   * when the scene describing it never changed.
   */
  private markAllDirty(): void {
    this.lastScene = undefined;
  }

  /**
   * Runs a key's bindings as if the hardware had reported a press and
   * release. Lets a configurator try a button without reaching for the deck,
   * and lets tests exercise a profile with no surface at all.
   */
  simulatePress(key: number): void {
    this.handleKeyDown(key);
    this.handleKeyUp(key);
  }

  /**
   * Runs a key's long-press bindings without waiting out the hold.
   *
   * Faithful to what the hardware produces: `down` fires, then `longPress`,
   * and no `up` at all — a real long press swallows its release, and a
   * simulation that emitted one would run actions the device never would.
   */
  simulateLongPress(key: number): void {
    const button = this.buttonAt(key);
    if (!button) return;

    void this.dispatch(button, 'down').then(() => this.dispatch(button, 'longPress'));
  }

  // --- internals ---------------------------------------------------------

  private requireTree(): ProfileTree {
    if (!this.tree) throw new EngineError('No profile loaded');
    return this.tree;
  }

  private initialLocation(profile: ProfileDefinition, tree: ProfileTree): DeckLocation {
    if (profile.initialPageId) {
      const owner = tree.ownerOf(profile.initialPageId);
      if (owner) return { folderId: owner.id, pageId: profile.initialPageId };
    }

    const folder = (profile.initialFolderId && tree.folder(profile.initialFolderId)) || tree.root;
    return { folderId: folder.id, pageId: folder.pages[0]!.id };
  }

  private moveTo(location: DeckLocation): void {
    if (this.location?.folderId === location.folderId && this.location.pageId === location.pageId) {
      return;
    }

    if (this.location) {
      this.history.push(this.location);
      if (this.history.length > this.historyLimit) this.history.shift();
    }

    this.location = location;
    this.emit('locationChanged', location);
    this.requestPaint();
  }

  private get currentPage(): PageDefinition | undefined {
    if (!this.tree || !this.location) return undefined;
    return this.tree.page(this.location.pageId);
  }

  private findButton(buttonId: string): ButtonDefinition | undefined {
    return this.currentPage?.buttons.find((button) => button.id === buttonId);
  }

  private buttonAt(key: number): ButtonDefinition | undefined {
    return this.currentPage?.buttons.find((button) => button.key === key);
  }

  private resolveState(button: ButtonDefinition): ButtonStateDefinition {
    if (button.stateFrom) {
      const bound = this.boundState(button, button.stateFrom);
      if (bound) return bound;
    }

    const override = this.stateOverrides.get(button.id);
    const explicit = button.states.find((state) => state.id === override);
    if (explicit) return explicit;

    const initial = button.states.find((state) => state.id === button.initialStateId);
    return initial ?? button.states[0]!;
  }

  /**
   * The value that would select this state — the inverse of `boundState`.
   *
   * Needed because forcing the state of a bound button means writing its
   * variable, and writing the state's id would be wrong for exactly the types
   * where the id is not the value: a boolean button named "off"/"on" would get
   * the string "on", and a carousel would get a name instead of an index.
   */
  private valueSelecting(
    button: ButtonDefinition,
    state: ButtonStateDefinition,
    name: string,
  ): VariableValue {
    if (state.when !== undefined) return state.when;

    const type = this.declarations.get(name)?.type ?? inferVariableType(this.variables.get(name));
    if (type === 'number') return Math.max(0, button.states.indexOf(state));
    if (type === 'boolean') return button.states.indexOf(state) === 1;
    return state.id;
  }

  /**
   * Which state a variable's current value selects. See `stateFrom` for the
   * rule this implements and why it is ordered the way it is.
   *
   * Returning undefined is meaningful: it means "this value says nothing", and
   * the caller then leaves the button on its override or its initial state
   * rather than blanking it.
   */
  private boundState(
    button: ButtonDefinition,
    name: string,
  ): ButtonStateDefinition | undefined {
    const value = this.variables.get(name);
    if (value === undefined) return undefined;

    // An explicit binding wins outright: the author said what they meant.
    const declared = button.states.find(
      (state) => state.when !== undefined && String(state.when) === String(value),
    );
    if (declared) return declared;

    // Then the state id, which is how binding worked before `when` existed.
    // Kept ahead of the type-specific rules so that no profile changes
    // behaviour just because its variables acquired declared types.
    const byId = button.states.find((state) => state.id === String(value));
    if (byId) return byId;

    const type = this.declarations.get(name)?.type ?? inferVariableType(value);

    if (type === 'number') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return undefined;

      // A carousel, so a plain counter walks the states in author order and
      // wraps round. Negative values count backwards from the end.
      const count = button.states.length;
      return button.states[((Math.trunc(numeric) % count) + count) % count];
    }

    if (type === 'boolean') {
      return button.states[isTruthy(value) ? 1 : 0] ?? button.states[0];
    }

    return undefined;
  }

  private resolveVisual(button: ButtonDefinition): ButtonVisual {
    const { visual } = this.resolveState(button);
    if (!visual.label) return visual;

    const snapshot: Record<string, VariableValue> = this.variables.snapshot();
    return { ...visual, label: { ...visual.label, text: renderTemplate(visual.label.text, snapshot) } };
  }

  /** The merged button whose picture covers this key, and where in it we are. */
  private spanCovering(
    key: number,
  ): { parent: ButtonDefinition; col: number; row: number } | undefined {
    const page = this.currentPage;
    if (!page) return undefined;

    const { cols: gridCols } = this.surface.layout;
    const col = key % gridCols;
    const row = Math.floor(key / gridCols);

    for (const button of page.buttons) {
      const cols = button.colSpan ?? 1;
      const rows = button.rowSpan ?? 1;
      if (cols === 1 && rows === 1) continue;

      const left = button.key % gridCols;
      const top = Math.floor(button.key / gridCols);
      if (col < left || col >= left + cols) continue;
      if (row < top || row >= top + rows) continue;

      return { parent: button, col: col - left, row: row - top };
    }

    return undefined;
  }

  /**
   * What a key shows once merges are taken into account.
   *
   * The merged button supplies the picture and the background for its whole
   * region; each covered key keeps its own label on top. A covered key with no
   * button of its own still shows its slice — otherwise a picture spread over
   * six keys would only appear where someone happened to put buttons, which is
   * precisely the arrangement you get when you want one big picture and one
   * action.
   */
  private visualForKey(key: number): ButtonVisual | undefined {
    const own = this.buttonAt(key);
    const span = this.spanCovering(key);
    if (!span) return own ? this.resolveVisual(own) : undefined;

    const parent = this.resolveVisual(span.parent);
    const label = own ? this.resolveVisual(own).label : undefined;

    return {
      // The merged button's fill wins: a picture split by fifteen different
      // background colours underneath it would be a picture in name only.
      ...(parent.background === undefined ? {} : { background: parent.background }),
      ...(parent.icon
        ? {
            backdrop: {
              source: parent.icon.source,
              col: span.col,
              row: span.row,
              cols: span.parent.colSpan ?? 1,
              rows: span.parent.rowSpan ?? 1,
              ...(parent.icon.fit ? { fit: parent.icon.fit } : {}),
            } satisfies BackdropSlice,
          }
        : {}),
      ...(label ? { label } : {}),
    };
  }

  private handleKeyDown(key: number): void {
    const button = this.buttonAt(key);
    if (!button) return;

    // A repeated press without a release means the release report was lost.
    // Drop the orphaned timer, or it would later fire a phantom long press.
    this.cancelPressTimer(key);

    this.longPressed.delete(key);
    const timer = this.clock.setTimeout(() => {
      this.pressTimers.delete(key);
      this.longPressed.add(key);
      void this.dispatch(button, 'longPress');
    }, this.longPressMs);
    this.pressTimers.set(key, timer);

    void this.dispatch(button, 'down');
  }

  private handleKeyUp(key: number): void {
    this.cancelPressTimer(key);
    const afterLongPress = this.longPressed.delete(key);

    // A long press swallows the release. Without this, holding a key would
    // run both its long-press action and its ordinary one — which is exactly
    // wrong when the two undo each other, as in hold-to-reset-a-counter.
    if (afterLongPress) return;

    const button = this.buttonAt(key);
    if (button) void this.dispatch(button, 'up');
  }

  private cancelPressTimer(key: number): void {
    const timer = this.pressTimers.get(key);
    if (timer === undefined) return;
    this.clock.clearTimeout(timer);
    this.pressTimers.delete(key);
  }

  private async dispatch(button: ButtonDefinition, event: ButtonEvent): Promise<void> {
    // Resolve the state at dispatch time: an earlier action in this same
    // batch may have changed it, and the press belongs to what was on screen.
    const state = this.resolveState(button);
    const list: readonly ActionDescriptor[] = state.actions?.[event] ?? [];
    if (list.length === 0) return;

    const context = this.actionContext(button);
    for (const action of list) {
      try {
        await this.actions.run(action, context);
      } catch (error) {
        // One bad action must not take the deck down with it.
        this.emit('error', error as Error);
      }
    }

    this.requestPaint();
  }

  private actionContext(button: ButtonDefinition): ActionContext {
    return {
      variables: this.variables,
      button: { id: button.id, key: button.key },
      location: this.location ?? { folderId: '', pageId: '' },
      profileId: this.profile?.id ?? '',
      openFolder: (folderId) => this.openFolder(folderId),
      goToPage: (pageId) => this.goToPage(pageId),
      goUp: () => this.goUp(),
      goHome: () => this.goHome(),
      goBack: () => this.goBack(),
      setButtonState: (buttonId, stateId) => this.setButtonState(buttonId, stateId),
    };
  }

  /**
   * Queues a repaint. Multiple requests inside one batch of work collapse
   * into a single pass, so a handful of variable writes cost one paint.
   */
  private requestPaint(): void {
    if (!this.running || this.paintQueued) return;
    this.paintQueued = true;

    this.paintChain = this.paintChain.then(
      () => this.runQueuedPaint(),
      () => this.runQueuedPaint(),
    );
  }

  private async runQueuedPaint(): Promise<void> {
    this.paintQueued = false;
    try {
      await this.paint();
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  /**
   * Describes the current page and hands it over.
   *
   * The comparison that decides whether anything changed is made on the
   * scene's signature, which names pictures rather than carrying them. The old
   * pass serialized every visual in full, data URLs included — 31ms of blocked
   * event loop on a panel-wide GIF, paid on every variable change, warm cache
   * or not.
   */
  private async paint(): Promise<void> {
    const scene = this.buildScene();
    if (!scene) return;

    const signature = sceneSignature(scene);
    if (signature === this.lastScene) return;
    this.lastScene = signature;

    await this.surface.present(scene);
    this.emit('painted', sceneKeys(scene, this.surface.layout.cols));
  }

  /**
   * The current page as regions.
   *
   * Merged pictures are claimed first, because they decide what the keys under
   * them show. Nothing here defends against two of them overlapping or one
   * running off the edge: `validateProfile` refuses both, so a profile that
   * reached this point cannot describe either.
   *
   * A covered key keeps its own label and contributes it to the region — that
   * is what lets one picture span six keys while each of them still says what
   * it does.
   */
  private buildScene(): Scene | undefined {
    const page = this.currentPage;
    if (!page) return undefined;

    const regions: SceneRegion[] = [];
    const claimed = new Set<number>();

    for (const button of page.buttons) {
      const cols = button.colSpan ?? 1;
      const rows = button.rowSpan ?? 1;
      if (cols === 1 && rows === 1) continue;

      for (const key of this.keysOfRegion(button.key, cols, rows)) claimed.add(key);
      regions.push(this.regionOf(button, cols, rows));
    }

    for (const button of page.buttons) {
      if ((button.colSpan ?? 1) !== 1 || (button.rowSpan ?? 1) !== 1) continue;
      if (claimed.has(button.key)) continue;

      regions.push(this.regionOf(button, 1, 1));
    }

    return { regions };
  }

  private keysOfRegion(key: number, cols: number, rows: number): number[] {
    const { cols: gridCols } = this.surface.layout;
    const left = key % gridCols;
    const top = Math.floor(key / gridCols);
    const keys: number[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) keys.push((top + row) * gridCols + left + col);
    }

    return keys;
  }

  private regionOf(button: ButtonDefinition, cols: number, rows: number): SceneRegion {
    const { cols: gridCols } = this.surface.layout;
    const visual = this.resolveVisual(button);
    const left = button.key % gridCols;
    const top = Math.floor(button.key / gridCols);

    const labels: SceneLabel[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const own = this.buttonAt((top + row) * gridCols + left + col);
        const label = own ? this.resolveVisual(own).label : undefined;
        if (!label) continue;

        labels.push({
          col,
          row,
          text: label.text,
          ...(label.color === undefined ? {} : { color: label.color }),
          ...(label.fontFamily === undefined ? {} : { fontFamily: label.fontFamily }),
          ...(label.fontSize === undefined ? {} : { fontSize: label.fontSize }),
          ...(label.position === undefined ? {} : { position: label.position }),
        });
      }
    }

    return {
      key: button.key,
      cols,
      rows,
      // The merged button's fill wins for the whole region: a picture split by
      // six different background colours underneath it would be a picture in
      // name only.
      ...(visual.background === undefined ? {} : { background: visual.background }),
      ...(visual.cornerRadius === undefined ? {} : { cornerRadius: visual.cornerRadius }),
      ...(visual.icon
        ? {
            image: {
              asset: { id: this.assets.id(visual.icon.source), source: visual.icon.source },
              ...(visual.icon.fit ? { fit: visual.icon.fit } : {}),
            },
          }
        : {}),
      ...(labels.length > 0 ? { labels } : {}),
    };
  }
}
