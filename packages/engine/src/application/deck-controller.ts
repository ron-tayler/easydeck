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
import { frameAt, nextChangeMs, prepare } from './animator.js';
import type { Animation } from './animator.js';
import { systemClock } from './ports/clock-port.js';
import type { ClockPort, TimerHandle } from './ports/clock-port.js';
import type { KeyRendererPort } from './ports/renderer-port.js';
import type { SurfacePort } from './ports/surface-port.js';

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
 * Stands in for "this key holds something, but not what it should".
 *
 * Never equal to a serialized visual, which always starts with `{`, so a key
 * marked with it always repaints.
 */
const DIRTY = '\0';

/**
 * Floor on how often the animation loop may wake.
 *
 * The measured ceiling is 233 key images a second across the whole panel, so
 * a key asking for more than this would only crowd out the others.
 */
const MIN_ANIMATION_TICK_MS = 15;

/**
 * Runs a profile on a surface: presses in, actions and repaints out.
 *
 * Repainting works by re-resolving every button on the current page and
 * comparing the result to what was last written to each key. That is cheaper
 * than it sounds for fifteen keys, and it removes a whole class of bugs that
 * a variable-to-button dependency map invites — a key can never be left
 * showing a stale value because some dependency was not recorded.
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
  /** Keys currently playing an animation, with their prepared frames. */
  private readonly animations = new Map<number, Animation>();
  private animationTimer?: TimerHandle;
  /** Serialized visual last written to each key, for change detection. */
  private readonly painted = new Map<number, string>();
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
    private readonly surface: SurfacePort,
    private readonly renderer: KeyRendererPort,
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
    // Belongs with the rest of what a new profile invalidates: the repaint
    // rebuilds them, and until it does these are frames of a page that is no
    // longer loaded.
    this.animations.clear();
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

    // Animations stop with everything else: a timer still writing frames after
    // the controller was told to stop would keep the device handle busy.
    if (this.animationTimer) this.clock.clearTimeout(this.animationTimer);
    this.animationTimer = undefined;
    this.animations.clear();

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
   * Marks every painted key as needing a rewrite, without forgetting which
   * keys hold an image.
   *
   * Emptying the map instead would look equivalent — everything repaints
   * either way — but a key whose button has just been moved away or deleted
   * has nothing to repaint, and clearing it is only possible while we still
   * remember that something was there. Forgetting leaves the old picture on
   * the device forever.
   */
  private markAllDirty(): void {
    for (const key of this.painted.keys()) this.painted.set(key, DIRTY);
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

  private async paint(): Promise<void> {
    const page = this.currentPage;
    if (!page) return;

    const { rows, cols } = this.surface.layout;
    const written: number[] = [];

    /*
     * Every key of one merged region starts its animation at the same instant.
     * Prepared independently they would each start whenever their turn came
     * round, and the region would play out of step with itself — which on a
     * six-key picture reads as a tear straight down the middle.
     */
    const regionStart = this.clock.now();

    for (let key = 0; key < rows * cols; key++) {
      const visual = this.visualForKey(key);

      if (!visual) {
        if (!this.painted.has(key)) continue;
        this.animations.delete(key);
        await this.surface.clearKey(key);
        this.painted.delete(key);
        written.push(key);
        continue;
      }
      const signature = JSON.stringify(visual);
      if (this.painted.get(key) === signature) continue;

      // A key that is changing to something else stops animating, whatever it
      // was doing before.
      this.animations.delete(key);

      /*
       * The still goes on first, always. Rendering a GIF's frames means
       * decoding it and re-encoding every one of them, and waiting for that
       * inside this loop held up every remaining key — one animated key made
       * the whole scene appear late.
       *
       * Drawing the still costs nothing extra: an animated source rasterizes
       * to its first frame, so the key shows the right picture immediately and
       * simply starts moving a moment later.
       */
      const image = await this.renderer.render(visual);
      await this.surface.setKeyImage(key, image);

      // Recorded only after a successful write, so a failed key is retried.
      this.painted.set(key, signature);
      written.push(key);

      this.beginAnimation(key, visual, signature, visual.backdrop ? regionStart : this.clock.now());
    }

    if (written.length > 0) this.emit('painted', written);
    this.driveAnimations();
  }

  // --- animation ------------------------------------------------------------

  /**
   * Asks for a visual's frames without holding up the paint that requested it.
   *
   * Deliberately not awaited. The frames are only needed to start moving, and
   * the key already shows the right first frame — so the rest of the scene
   * paints at once instead of queueing behind a decode.
   *
   * `startedAt` is passed in rather than read here: every key of one merged
   * picture shares the paint's timestamp, so they stay in step even though
   * their frames arrive at different moments. A key whose decode finished late
   * simply joins at the frame the clock says, mid-cycle.
   */
  private beginAnimation(
    key: number,
    visual: ButtonVisual,
    signature: string,
    startedAt: number,
  ): void {
    if (!this.renderer.renderFrames) return;

    void this.renderer
      .renderFrames(visual)
      .then((frames) => {
        if (!frames || frames.length < 2 || !this.running) return;
        // The key may have moved on while this was decoding; whatever is there
        // now was decided more recently than this answer.
        if (this.painted.get(key) !== signature) return;

        this.animations.set(key, prepare(frames, startedAt));
        this.driveAnimations();
      })
      .catch((error: unknown) => this.emit('error', error as Error));
  }

  /**
   * Starts or stops the single timer that drives every animated key.
   *
   * One timer for all of them rather than one each: the surface serializes
   * writes anyway, so independent timers would only compete for the same queue
   * and make the ordering harder to reason about.
   */
  private driveAnimations(): void {
    if (this.animations.size === 0) {
      if (this.animationTimer) {
        this.clock.clearTimeout(this.animationTimer);
        this.animationTimer = undefined;
      }
      return;
    }

    if (this.animationTimer || !this.running) return;
    this.scheduleAnimationTick(0);
  }

  /**
   * Ticks run on the paint chain, not a chain of their own.
   *
   * Both write to the surface, and two chains can interleave: a tick already
   * awaiting a write would resume *after* a repaint had replaced that key, put
   * its stale frame back, and leave the key wrong for good — the repaint has
   * already recorded the key as up to date, so nothing would ever correct it.
   * One chain for everything that touches the panel is the only ordering that
   * cannot produce that.
   */
  private scheduleAnimationTick(delayMs: number): void {
    this.animationTimer = this.clock.setTimeout(() => {
      this.animationTimer = undefined;
      this.paintChain = this.paintChain.then(
        () => this.runAnimationTick(),
        () => this.runAnimationTick(),
      );
    }, delayMs);
  }

  private async runAnimationTick(): Promise<void> {
    if (!this.running || this.animations.size === 0) return;

    try {
      const now = this.clock.now();

      for (const [key, animation] of this.animations) {
        const index = frameAt(animation, now);
        if (index === animation.shown) continue;

        await this.surface.setKeyImage(key, animation.frames[index]!.image);
        animation.shown = index;
      }
    } catch (error) {
      this.emit('error', error as Error);
    }

    if (!this.running || this.animations.size === 0) return;

    /*
     * Waking when the earliest key next wants a frame, rather than on a fixed
     * interval. A GIF carries its own per-frame delays and the vendor software
     * honours them — the capture shows keys running at 12.8 and 21 frames a
     * second side by side, which is exactly what those files ask for.
     *
     * Never busier than the floor: writes take time, and a zero delay would
     * spin the queue rather than paint anything sooner.
     */
    const after = this.clock.now();
    let soonest = Number.POSITIVE_INFINITY;
    for (const animation of this.animations.values()) {
      soonest = Math.min(soonest, nextChangeMs(animation, after));
    }

    this.scheduleAnimationTick(Math.max(MIN_ANIMATION_TICK_MS, Math.round(soonest)));
  }
}
