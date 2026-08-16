import { EventEmitter } from 'node:events';

import type { ActionContext, ActionDescriptor, ButtonEvent } from '../domain/action.js';
import { CORE_ON, THIS_BUTTON } from '../domain/action.js';
import { evaluateCondition } from '../domain/condition.js';
import type { Condition } from '../domain/condition.js';
import { EngineError } from '../domain/errors.js';
import type {
  ButtonDefinition,
  ButtonStateDefinition,
  DeckLocation,
  FolderDefinition,
  PageDefinition,
  ProfileDefinition,
} from '../domain/profile.js';
import { isStateRange, withinRange } from '../domain/profile.js';
import { ProfileTree } from '../domain/profile-tree.js';
import { variablesPaintedBy } from '../domain/profile-variables.js';
import { sceneKeys, sceneSignature } from '../domain/scene.js';
import type { Scene, SceneImage, SceneLabel, SceneRegion } from '../domain/scene.js';
import { surfaceKey } from '../domain/surface-spec.js';
import type {
  SurfaceFrame,
  SurfaceProvider,
  SurfaceRequest,
  SurfaceSpec,
  WidgetOnScreen,
  WidgetOverride,
} from '../domain/surface-spec.js';
import { readIconParams, resolveIconParams, svgTextOf } from '../domain/icon-params.js';
import { drawableIcon } from '../domain/icon-source.js';
import { renderTemplate } from '../domain/template.js';
import { validateProfile } from '../domain/validate-profile.js';
import {
  VariableStore,
  inferVariableType,
  initialVariableValue,
  isTruthy,
} from '../domain/variables.js';
import type { VariableDeclaration, VariableValue } from '../domain/variables.js';
import type { BackdropSlice, ButtonVisual, IconSpec } from '../domain/visual.js';
import type { ActionRegistry } from './action-registry.js';
import { AssetIds } from './asset-ids.js';
import { runScript } from './script-runner.js';
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
  readonly clock?: ClockPort;
  /**
   * Identifies which deck this is, for actions that care.
   *
   * Several decks run at once вЂ” two panels, or a panel and a tablet вЂ” and an
   * action needs to know which one its press came from, if only so that
   * navigation moves the deck the user actually touched.
   */
  readonly deckId?: string;
  /**
   * Where variables live. Omit and this deck gets its own.
   *
   * Passing one shared store is what makes several decks a single machine
   * rather than several: mute the mic on the tablet and the button on the
   * panel goes red, because there is one truth about the mic and both decks
   * are reading it. Only *where the deck is* вЂ” its profile, its page, its
   * history вЂ” is private to it.
   */
  readonly variables?: VariableStore;
  /** How many locations `goBack` can retrace. */
  readonly historyLimit?: number;
  /**
   * Draws the pictures plugins own, when a key asks for one.
   *
   * Absent in a deck with no plugins behind it вЂ” a test, an example вЂ” and then
   * a key wanting a live picture simply shows its background and label.
   */
  readonly surfaces?: SurfaceProvider;
}

export interface DeckControllerEvents {
  /** Something failed in a way that should not stop the deck. */
  error: [error: Error];
  locationChanged: [location: DeckLocation];
  /**
   * Emitted after every repaint pass, with the keys written and how they look.
   *
   * The views ride along rather than being fetched afterwards. A window that
   * heard "something changed" and asked what could only ask about the whole
   * page, so every variable that moved cost a round trip and a rebuild of
   * fifteen keys to learn that one label had gained a digit.
   */
  painted: [keys: number[], views: KeyView[]];
  /**
   * The widgets on screen changed, and the plugins should hear about it.
   *
   * The counterpart of the watched-variable list, and scoped the same way: a
   * plugin is told what is being drawn, not what exists.
   */
  widgets: [widgets: readonly WidgetOnScreen[]];
}

/** Long enough to notice, short enough not to sit there accusing. */
const ALERT_MS = 3000;

/**
 * How many times handlers may set each other off before the chain is cut.
 *
 * A handler that writes a variable brings the engine straight back to the
 * handlers, which is useful вЂ” one arming another вЂ” and is also how a profile
 * stops the deck answering. Four is past anything deliberate.
 */
const MAX_CASCADE = 4;

const DEFAULT_HISTORY_LIMIT = 32;

/**
 * Runs a profile on a panel: presses in, actions and scenes out.
 *
 * Repainting works by re-resolving every button on the current page and
 * describing the result as a scene. That is cheaper than it sounds for fifteen
 * keys, and it removes a whole class of bugs that a variable-to-button
 * dependency map invites вЂ” a key can never be left showing a stale value
 * because some dependency was not recorded.
 *
 * What the controller deliberately does not do is decide what reaches the
 * hardware. It says how the panel should look; slicing pictures, caching
 * tiles, pacing animation against the bus and skipping writes belong to the
 * presenter, which can see the whole panel at once and measure what it does.
 */
export class DeckController extends EventEmitter<DeckControllerEvents> {
  readonly variables: VariableStore;
  /** Which deck this is; see `DeckControllerOptions.deckId`. */
  readonly deckId: string;

  private profile?: ProfileDefinition;
  private tree?: ProfileTree;
  private location?: DeckLocation;
  /** Visited locations, most recent last, for `goBack`. */
  private readonly history: DeckLocation[] = [];
  /** Explicit state overrides, for buttons not bound to a variable. */
  private readonly stateOverrides = new Map<string, string>();
  /**
   * Widget settings changed while the deck runs, by button and name.
   *
   * The same idea as `stateOverrides` and for the same reason: what a key is
   * *showing* is a fact about this moment, and the profile is what somebody
   * authored. A press that switched a graph from the processor to the memory
   * would otherwise edit the document, and an export would carry whatever was
   * last pressed.
   *
   * The author of each change is kept beside it. Several things may write
   * here вЂ” a macro, this plugin, another plugin вЂ” and "why is my graph showing
   * memory" needs an answer better than a shrug.
   */
  private readonly widgetOverrides = new Map<string, Map<string, WidgetOverride>>();
  /** Declared variables by name: the profile's, plus every plugin's. */
  private declarations = new Map<string, VariableDeclaration>();
  /** Short names for pictures, so no scene ever carries their bytes around. */
  private readonly assets = new AssetIds();
  /** Signature of the scene last presented, for change detection. */
  private lastScene?: string;

  /**
   * Whether each event handler's condition held last time it was looked at.
   *
   * Keyed by button and position, and the whole of what makes a handler fire
   * on the edge rather than for as long as its condition is true.
   */
  private readonly handlerHeld = new Map<string, boolean>();
  /** True while handlers are running, so one cannot re-enter the loop. */
  private handling = false;
  /** Set when something changed mid-round, which asks for another one. */
  private changedWhileHandling = false;

  private readonly unsubscribe: Array<() => void> = [];
  private running = false;
  /** Serializes repaints so two rapid presses cannot interleave writes. */
  private paintChain: Promise<unknown> = Promise.resolve();
  private paintQueued = false;
  /**
   * Keys whose last press failed, and the timer that clears each of them.
   *
   * A press that throws used to leave no trace anywhere the user was looking:
   * the daemon logged it, the deck carried on, and the person pressing the key
   * had no way to tell a broken macro from one that does its work quietly. The
   * key says so itself now, for a few seconds вЂ” the only screen a physical
   * panel has is its own keys.
   */
  private readonly failing = new Map<number, TimerHandle>();

  private readonly historyLimit: number;
  private readonly clock: ClockPort;
  private readonly surfaces: SurfaceProvider | undefined;
  /** Pictures gathered for this pass, by the spec that asked for them. */
  private readonly drawn = new Map<string, SurfaceFrame>();
  /** What the plugins were last told is on screen, to avoid saying it twice. */
  private lastWidgets = '';

  constructor(
    private readonly surface: PresenterPort,
    private readonly actions: ActionRegistry,
    options: DeckControllerOptions = {},
  ) {
    super();
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.clock = options.clock ?? systemClock;
    this.variables = options.variables ?? new VariableStore();
    this.deckId = options.deckId ?? 'default';
    this.surfaces = options.surfaces;
  }

  get currentLocation(): DeckLocation | undefined {
    return this.location;
  }

  /** The deck's grid, as the profile must match it. */
  get layout(): { readonly rows: number; readonly cols: number } {
    return this.surface.layout;
  }

  /** The profile as loaded, for whoever needs to read it rather than run it. */
  get loadedProfile(): ProfileDefinition | undefined {
    return this.profile;
  }

  get profileId(): string | undefined {
    return this.profile?.id;
  }

  /** Root first, current folder last вЂ” the breadcrumb a UI shows. */
  get folderPath(): FolderDefinition[] {
    if (!this.tree || !this.location) return [];
    return this.tree.pathTo(this.location.folderId);
  }

  /** Pages of the folder the deck is in, in author order. */
  get currentFolderPages(): readonly PageDefinition[] {
    if (!this.tree || !this.location) return [];
    return this.tree.folder(this.location.folderId)?.pages ?? [];
  }

  /**
   * Changes one setting of the widget on a key.
   *
   * `undefined` puts it back to whatever the profile says, which is how a key
   * that switched a graph to the memory switches it back without needing to
   * know what it was before.
   *
   * A button with no widget is not an error: a profile is edited while the
   * deck runs, and a macro pointed at a key whose widget was removed should do
   * nothing rather than take the press down with it.
   */
  setWidgetParam(
    buttonId: string,
    name: string,
    value: VariableValue | undefined,
    by = 'unknown',
  ): void {
    const forButton = this.widgetOverrides.get(buttonId) ?? new Map<string, WidgetOverride>();

    if (value === undefined) forButton.delete(name);
    else forButton.set(name, { value, by });

    if (forButton.size > 0) this.widgetOverrides.set(buttonId, forButton);
    else this.widgetOverrides.delete(buttonId);

    this.markAllDirty();
    this.requestPaint();
    // A handler may be waiting on exactly this: a condition can ask what a
    // widget is set to, and without this the answer would change while nothing
    // noticed. Variables get the same treatment from their own store.
    void this.runHandlers();
  }

  /**
   * The widgets on the page this deck is showing, settings and all.
   *
   * The same question `tellWidgets` answers by event, asked directly вЂ” for
   * whoever joins after the last repaint and would otherwise wait for the next
   * one to find out what is there.
   */
  widgetsOnScreen(): WidgetOnScreen[] {
    const page = this.currentPage;
    if (!page) return [];

    const found: WidgetOnScreen[] = [];
    for (const button of page.buttons) {
      const spec = this.widgetOf(button);
      if (spec) found.push({ buttonId: button.id, type: spec.type, params: spec.params ?? {} });
    }

    return found;
  }

  /** What has been laid over the profile, for a reload to hand back. */
  get widgetSettings(): ReadonlyMap<string, ReadonlyMap<string, WidgetOverride>> {
    return new Map([...this.widgetOverrides].map(([key, values]) => [key, new Map(values)]));
  }

  /**
   * Puts back the widget settings an edit should not have disturbed.
   *
   * The same rule as the forced states next door, and the same reason for
   * leaving the decision to the caller: only it knows the profile is the same
   * one. What is dropped is what no longer exists вЂ” a key whose widget was
   * removed, or a setting that widget no longer declares.
   */
  restoreWidgetSettings(settings: ReadonlyMap<string, ReadonlyMap<string, WidgetOverride>>): void {
    for (const [buttonId, values] of settings) {
      const button = this.buttonById(buttonId);
      // Every state, not the one showing: which state that is depends on the
      // variables, and deciding from it would be circular.
      if (!button?.states.some((state) => state.visual.surface)) continue;

      const kept = new Map(values);
      if (kept.size > 0) this.widgetOverrides.set(buttonId, kept);
    }

    this.markAllDirty();
    this.requestPaint();
  }

  /**
   * The states forced by `set-button-state`, for a reload to hand back.
   *
   * A copy: what a caller holds across a `load` must not be the map the load
   * is about to clear.
   */
  get forcedStates(): ReadonlyMap<string, string> {
    return new Map(this.stateOverrides);
  }

  /**
   * Puts back the forced states an edit should not have disturbed.
   *
   * A button whose state was set by an action rather than bound to a variable
   * keeps that state in memory and nowhere else вЂ” the profile has no field for
   * "which state it happens to be showing", and should not: it is a fact about
   * this moment, not about the document. So a reload forgets it, and editing
   * one key on a page reset every other key on that page to its first state.
   *
   * Restored rather than never cleared, because whether the states still mean
   * anything depends on what was loaded. Only the caller knows the profile is
   * the same one вЂ” button ids are handed out per profile and `button-1` exists
   * in most of them, so keeping them across a genuine switch would put a key
   * into a state that belongs to somebody else's profile.
   *
   * What is dropped here is what no longer exists: a button that was deleted,
   * or a state that was renamed while it was showing.
   */
  restoreForcedStates(states: ReadonlyMap<string, string>): void {
    for (const [buttonId, stateId] of states) {
      const button = this.buttonById(buttonId);
      if (!button?.states.some((state) => state.id === stateId)) continue;
      this.stateOverrides.set(buttonId, stateId);
    }

    this.markAllDirty();
    this.requestPaint();
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
     * a plugin variable вЂ” to give it a starting value вЂ” without being able to
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

    /*
     * The handlers start again from where the world is now.
     *
     * A running deck reloads its profile whenever the editor saves, and the
     * readings taken before that belong to handlers that may no longer exist:
     * they are keyed by button and position, so an edited condition inherits
     * the old one's answer. That shows up as a handler that does not fire the
     * first time it should вЂ” the worst kind of bug to be handed, since the fix
     * is to press the key and it works.
     *
     * Taking a fresh reading also means a condition that is already true after
     * an edit does not fire, which is the same promise start() makes.
     */
    if (this.running) this.rememberHandlerStates();
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

    // Where every handler stands before anything has changed, so a condition
    // that is already true on startup does not read as having just become so.
    this.rememberHandlerStates();

    this.unsubscribe.push(
      this.surface.onGesture((key, gesture) => this.handleGesture(key, gesture)),
      this.variables.onChange((change) => {
        /*
         * Only what this page reads, and only for the painting.
         *
         * Handlers are profile-wide вЂ” a key on another page may be waiting for
         * exactly this вЂ” so they are run whatever changed. The picture is not:
         * a page that mentions nothing of the sort cannot look different, and
         * rebuilding its scene to find that out was the whole cost.
         */
        if (this.paintsOn(change.name)) this.requestPaint();
        void this.runHandlers();
      }),
    );

    await this.paint();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this.clearAlerts();
    for (const off of this.unsubscribe.splice(0)) off();

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

  /** Any page is reachable, not only a sibling вЂ” the folder follows the page. */
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
    // вЂ” otherwise the override and the variable would disagree.
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
   * state binding and templating вЂ” the two things most likely to drift
   * between an engine and a UI that each resolve them separately.
   */
  view(): KeyView[] {
    const page = this.currentPage;
    if (!page) return [];

    /*
     * Walks keys rather than buttons, because a merged picture reaches keys
     * that hold no button of their own. Those are reported under the merged
     * button's identity вЂ” it is the one that put something there.
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
        visual: this.failing.has(key) ? { ...visual, alert: true } : visual,
      });
    }

    return views;
  }

  /** Forgets every complaint and cancels its timer. */
  private clearAlerts(): void {
    for (const timer of this.failing.values()) this.clock.clearTimeout(timer);
    this.failing.clear();
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
   * against the real thing вЂ” so a key that lost its picture is repainted even
   * when the scene describing it never changed.
   */
  private markAllDirty(): void {
    this.lastScene = undefined;
  }

  /**
   * Whether a change to this variable could alter what is on screen.
   *
   * Worked out from the page and kept against the page *object*, so a profile
   * that has been reloaded вЂ” a new object every time вЂ” is never answered from
   * the old one's set. That is the only staleness this could suffer, and
   * identity closes it without anybody having to remember to invalidate.
   */
  private paintsOn(name: string): boolean {
    const page = this.currentPage;
    if (!page) return false;

    if (this.paintedByPage !== page) {
      this.paintedBy = variablesPaintedBy(page);
      this.paintedByPage = page;
    }

    return this.paintedBy.has(name);
  }

  private paintedBy = new Set<string>();
  private paintedByPage?: PageDefinition;

  /**
   * Runs a gesture's bindings without anyone touching the deck.
   *
   * The gesture is named rather than acted out. Feeding synthetic presses
   * through the recogniser would make a configurator's "try this button" wait
   * out the double-press window before anything happened, and would leave the
   * key mid-gesture if the caller stopped there.
   */
  simulatePress(key: number): void {
    this.simulate(key, 'press');
  }

  simulateLongPress(key: number): void {
    this.simulate(key, 'longPress');
  }

  simulateDoublePress(key: number): void {
    this.simulate(key, 'doublePress');
  }

  private simulate(key: number, event: ButtonEvent): void {
    const button = this.buttonAt(key);
    if (button) void this.dispatch(button, event);
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
   * The value that would select this state вЂ” the inverse of `boundState`.
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
    if (isStateRange(state.when)) {
      // The low end, because a band is usually written from where it starts;
      // a band open at the bottom is selected by its top.
      return state.when.min ?? state.when.max ?? 0;
    }
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
      (state) =>
        state.when !== undefined &&
        !isStateRange(state.when) &&
        String(state.when) === String(value),
    );
    if (declared) return declared;

    // Then a band, which is what makes a gauge out of a button. Ahead of the
    // id and of the carousel, both of which would otherwise claim the value
    // first and leave the bands unreachable.
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      const banded = button.states.find(
        (state) => isStateRange(state.when) && withinRange(numeric, state.when),
      );
      if (banded) return banded;
    }

    // Then the state id, which is how binding worked before `when` existed.
    // Kept ahead of the type-specific rules so that no profile changes
    // behaviour just because its variables acquired declared types.
    const byId = button.states.find((state) => state.id === String(value));
    if (byId) return byId;

    const type = this.declarations.get(name)?.type ?? inferVariableType(value);

    if (type === 'number') {
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

  /**
   * The picture as the panel will draw it, and a name for it.
   *
   * An ordinary icon passes straight through and is named by its own contents,
   * which is what the immutable cache downstream wants.
   *
   * A picture that had something substituted into it is named by *what decided
   * it* вЂ” the artwork it came from, and the values written into it вЂ” rather
   * than by hashing what it came to. The name still changes with every value,
   * and has to: a needle at 38% is a different picture from the same needle at
   * 39%, and the tile cache is keyed on this. What changes is the price of
   * saying so. Hashing the result meant a full pass over the whole picture on
   * every tick of every variable, and a map holding a copy of the picture for
   * each value it had ever taken вЂ” affordable while a parametric icon was a few
   * hundred bytes of markup, and not once one can carry a photograph inside it.
   */
  private assetFor(icon: IconSpec): { id: string; source: string } {
    const drawable = drawableIcon(icon);
    if (drawable === icon.source) return { id: this.assets.id(drawable), source: drawable };

    // The artwork is hashed once, ever: profiles hand back the same string on
    // every pass, so this is a lookup rather than a hash after the first time.
    const artwork = this.assets.id(icon.source);
    const decided = JSON.stringify([icon.color ?? null, icon.colors ?? null, icon.values ?? null]);

    return { id: this.assets.id(`${artwork}|${decided}`), source: drawable };
  }

  private resolveVisual(button: ButtonDefinition): ButtonVisual {
    const { visual } = this.resolveState(button);

    /*
     * A picture counts as parametric once it *declares* anything, bound or
     * not: its own defaults have to be worked out too, so an icon dropped on
     * a key and not yet wired up still shows what it was drawn to show.
     */
    const iconParams = visual.icon ? readIconParams(svgTextOf(visual.icon.source) ?? '') : [];
    const parametric = iconParams.length > 0 || visual.icon?.params !== undefined;

    /*
     * The widget as it stands, which is not always what the profile says.
     *
     * Worked out here rather than read off the visual, because everything
     * below identifies a frame by its settings: a key a macro has pointed
     * somewhere else asks for one picture and would look for another.
     */
    const spec = this.widgetOf(button);

    // A key showing nothing but a widget has neither label nor icon, and used
    // to leave through here before its frame was ever substituted.
    if (!visual.label && !parametric && !spec) return visual;

    const snapshot: Record<string, VariableValue> = this.variables.snapshot();

    const label = visual.label
      ? { ...visual.label, text: renderTemplate(visual.label.text, snapshot) }
      : undefined;

    /*
     * The icon's parameters are worked out here and left beside it, rather
     * than written into it.
     *
     * Substituting them now would produce a different picture on every
     * repaint, and pictures are addressed and cached by their contents вЂ” a
     * needle that moved would defeat the cache it depends on. Whoever draws
     * the key does the substituting, on a copy.
     */
    const icon =
      parametric && visual.icon
        ? {
            ...visual.icon,
            values: resolveIconParams(iconParams, visual.icon.params, snapshot),
          }
        : visual.icon;

    /*
     * A widget's frame becomes the picture, here and not further down.
     *
     * Everything that asks what a key looks like вЂ” the scene the panel is
     * built from, and the views a window and a tablet draw вЂ” goes through this
     * one method. Substituting at the end means all three see a picture and
     * none of them needs to know that a plugin drew it, which is the whole
     * reason a widget can sit in the same slot as a still.
     *
     * Doing it only in the scene is what the first attempt did, and the panel
     * showed the graph while the configurator showed an empty key.
     */
    const live = spec ? this.drawn.get(surfaceKey(spec)) : undefined;
    // Only the source: what identifies the picture to the tile cache is the
    // frame's own id, and the scene reads that from the frame in `pictureOf`.
    const picture = live ? { source: live.source } : icon;

    return {
      ...visual,
      // The resolved widget travels on, so whoever looks the frame up again
      // downstream asks the same question and gets the same answer.
      ...(spec ? { surface: spec } : {}),
      ...(label ? { label } : {}),
      ...(picture ? { icon: picture } : {}),
    };
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
   * button of its own still shows its slice вЂ” otherwise a picture spread over
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
            } satisfies BackdropSlice,
          }
        : {}),
      ...(label ? { label } : {}),
    };
  }

  /**
   * A gesture happened on a key: run whatever that key binds to it.
   *
   * Which gesture it was has already been decided by the surface, so there is
   * nothing to time or disambiguate here.
   */
  private handleGesture(key: number, gesture: ButtonEvent): void {
    const button = this.buttonAt(key);
    if (button) void this.dispatch(button, gesture);
  }

  /**
   * Keys whose current state binds a double press.
   *
   * Recomputed with the scene, because it changes with it: a button that
   * switches state can gain or lose the binding, and a recogniser holding a
   * stale answer would either delay a key for nothing or miss a second tap.
   */
  private doublePressKeys(): number[] {
    return this.keysBoundTo('doublePress');
  }

  /**
   * Keys whose current appearance has something bound to holding them.
   *
   * Told to the surface for the same reason the double-press keys are: the
   * shrink-while-held is an acknowledgement, and once a hold has fired there
   * is nothing left to acknowledge вЂ” the key can come back up while the
   * finger is still down. On a key with nothing bound to holding, it stays
   * down, because there the shrink is all the feedback there is.
   */
  private longPressKeys(): number[] {
    return this.keysBoundTo('longPress');
  }

  private keysBoundTo(event: ButtonEvent): number[] {
    const page = this.currentPage;
    if (!page) return [];

    return page.buttons.filter((button) => this.scriptFor(button, event).length > 0).map((button) => button.key);
  }

  /**
   * The script a button runs for a gesture, which is usually not its state's.
   *
   * A button has one script, held by its first state, and every other state
   * follows it вЂ” a key that looks different when the mic is muted still does
   * the same thing when pressed. A state that genuinely acts differently says
   * so with `ownActions`, and then its own is used.
   */
  private scriptFor(button: ButtonDefinition, event: ButtonEvent): readonly ActionDescriptor[] {
    const state = this.resolveState(button);
    const owner = state.ownActions || state === button.states[0] ? state : button.states[0];
    return owner?.actions?.[event] ?? [];
  }

  private async dispatch(button: ButtonDefinition, event: ButtonEvent): Promise<void> {
    // Resolved at dispatch time: an earlier action in this same batch may have
    // changed the state, and the press belongs to what was on screen.
    const list = this.scriptFor(button, event);
    if (list.length === 0) return;

    const context = this.actionContext(button);

    try {
      await runScript(list, context, {
        run: (action, where) => this.actions.run(action, where),
        values: () => this.variables.snapshot(),
        onError: (error) => {
          // One bad step must not take the deck down with it, and the key says
          // so вЂ” which is the same behaviour a flat list of actions had.
          this.markFailed(button.key);
          this.emit('error', error);
        },
        // Through the deck's own clock, so a test with a fake one does not
        // spend real seconds on a script full of waits.
        wait: (ms) => new Promise<void>((resolve) => this.clock.setTimeout(resolve, ms)),
      });
    } catch (error) {
      // A limit, rather than a step: the script is not doing what it says, so
      // it stopped part-way and the key has to show that.
      this.markFailed(button.key);
      this.emit('error', error as Error);
    }

    this.requestPaint();
  }

  // --- handlers that watch rather than wait for a finger --------------------

  /**
   * Every `core.on` in the profile, wherever its button happens to sit.
   *
   * The whole profile rather than the current page, deliberately: "when the
   * scene changes, mute the mic" that worked only while you happened to be
   * looking at the page holding that button would be automation you could not
   * rely on, and the failure would look like nothing at all.
   */
  private eventHandlers(): { key: string; button: ButtonDefinition; step: ActionDescriptor }[] {
    const found: { key: string; button: ButtonDefinition; step: ActionDescriptor }[] = [];
    if (!this.profile) return found;

    const walk = (folder: FolderDefinition): void => {
      for (const page of folder.pages) {
        for (const button of page.buttons) {
          const script = this.scriptFor(button, 'event');
          script.forEach((step, index) => {
            if (step.type === CORE_ON) found.push({ key: `${button.id}#${index}`, button, step });
          });
        }
      }
      for (const child of folder.folders ?? []) walk(child);
    };

    walk(this.profile.root);
    return found;
  }

  private conditionHolds(step: ActionDescriptor, button: ButtonDefinition): boolean {
    const when = step.params?.['when'] as Condition | undefined;
    if (!when) return false;

    return evaluateCondition(when, {
      values: this.variables.snapshot(),
      buttonState: (buttonId) => {
        const target = this.buttonAsked(buttonId, button);
        return target ? this.resolveState(target).id : undefined;
      },
      widgetParam: (buttonId, name) =>
        this.widgetParamOf(this.buttonAsked(buttonId, button)?.id ?? button.id, name),
    });
  }

  /**
   * The key a condition is asking about, with `this_btn` resolved.
   *
   * An empty name still means the key running the script, but a form cannot
   * offer that as a choice вЂ” a blank select reads as "nobody has answered
   * yet". So the lists say "this button" out loud and store `this_btn`, and it
   * has to mean the same thing here as it does in an action, or an `if` about
   * one's own widget quietly asks about a button that does not exist and every
   * answer is `undefined`.
   */
  private buttonAsked(
    chosen: string | undefined,
    running: ButtonDefinition,
  ): ButtonDefinition | undefined {
    if (!chosen || chosen === THIS_BUTTON || chosen === running.id) return running;
    return this.buttonById(chosen);
  }

  /**
   * One setting of a key's widget, as it stands right now.
   *
   * Read through `widgetOf`, so anything a macro or a plugin laid over the
   * profile is what a condition sees. Asking about the authored value would
   * make "is that graph showing the memory" answer about a graph nobody is
   * looking at.
   */
  private widgetParamOf(buttonId: string, name: string): VariableValue | undefined {
    const button = this.buttonById(buttonId);
    const spec = button ? this.widgetOf(button) : undefined;
    const value = spec?.params?.[name];

    // Only the kinds a comparison can do anything with; a widget may declare
    // whatever it likes, and an object compared with a number is nonsense
    // dressed up as an answer.
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? value
      : undefined;
  }

  /** Takes a reading without acting on it, so the next change is a change. */
  private rememberHandlerStates(): void {
    this.handlerHeld.clear();
    for (const handler of this.eventHandlers()) {
      this.handlerHeld.set(handler.key, this.conditionHolds(handler.step, handler.button));
    }
  }

  /**
   * Runs the handlers whose condition has just become true.
   *
   * On the edge rather than the level: a handler watching "processor over 90"
   * should act when it climbs past ninety, not once a second for as long as it
   * is busy.
   *
   * A handler may change a variable, which brings us straight back here. That
   * is useful вЂ” one handler arming another вЂ” and it is also how a profile
   * locks the deck up, so the chain is counted and cut.
   */
  private async runHandlers(): Promise<void> {
    if (!this.running) return;

    // A handler writing a variable lands here again. Noted and dealt with by
    // the loop below rather than by running now: re-entering would run the
    // handlers inside a handler, in an order nobody could predict.
    if (this.handling) {
      this.changedWhileHandling = true;
      return;
    }

    this.handling = true;
    try {
      for (let round = 1; ; round += 1) {
        this.changedWhileHandling = false;
        await this.handlerRound();

        if (!this.changedWhileHandling) break;

        /*
         * Another round, because a handler changed something вЂ” one arming
         * another is the point of having several. Bounded, because two
         * handlers undoing each other is the same thing seen from the other
         * side, and that one never stops.
         */
        if (round >= MAX_CASCADE) {
          this.emit(
            'error',
            new EngineError(
              `Event handlers set each other off ${MAX_CASCADE} rounds deep; stopped to keep the deck answering`,
            ),
          );
          break;
        }
      }
    } finally {
      this.handling = false;
    }
  }

  /** One pass over every handler, running those that have just become true. */
  private async handlerRound(): Promise<void> {
    for (const handler of this.eventHandlers()) {
      const holds = this.conditionHolds(handler.step, handler.button);
      const held = this.handlerHeld.get(handler.key) === true;
      this.handlerHeld.set(handler.key, holds);

      if (!holds || held) continue;

      const body = handler.step.branches?.['do'] ?? [];
      if (body.length === 0) continue;

      await this.runOn(handler.button, body);
    }
  }

  /** One handler's body, run like any other script on that button. */
  private async runOn(button: ButtonDefinition, body: readonly ActionDescriptor[]): Promise<void> {
    try {
      await runScript(body, this.actionContext(button), {
        run: (action, where) => this.actions.run(action, where),
        values: () => this.variables.snapshot(),
        onError: (error) => {
          this.markFailed(button.key);
          this.emit('error', error);
        },
        wait: (ms) => new Promise<void>((resolve) => this.clock.setTimeout(resolve, ms)),
      });
    } catch (error) {
      this.markFailed(button.key);
      this.emit('error', error as Error);
    }

    this.requestPaint();
  }

  /** A button anywhere in the profile, which is where a handler's may be. */
  /**
   * A button anywhere in the loaded profile, by id.
   *
   * Exposed because a configurator asking "what widget is on that key" is
   * asking about the document rather than about the page on screen вЂ” the key
   * being pointed at may well be on another page.
   */
  buttonInProfile(buttonId: string): ButtonDefinition | undefined {
    return this.buttonById(buttonId);
  }

  private buttonById(buttonId: string): ButtonDefinition | undefined {
    const search = (folder: FolderDefinition): ButtonDefinition | undefined => {
      for (const page of folder.pages) {
        const found = page.buttons.find((button) => button.id === buttonId);
        if (found) return found;
      }
      for (const child of folder.folders ?? []) {
        const found = search(child);
        if (found) return found;
      }
      return undefined;
    };

    return this.profile ? search(this.profile.root) : undefined;
  }

  /**
   * Flags a key as having failed, and unflags it a few seconds later.
   *
   * A repeat failure restarts the clock rather than adding a second mark: the
   * question the sign answers is "did that press work", and the answer belongs
   * to the most recent one.
   */
  private markFailed(key: number): void {
    const standing = this.failing.get(key);
    if (standing !== undefined) this.clock.clearTimeout(standing);

    this.failing.set(
      key,
      this.clock.setTimeout(() => {
        this.failing.delete(key);
        this.requestPaint();
      }, ALERT_MS),
    );

    this.requestPaint();
  }

  private actionContext(button: ButtonDefinition): ActionContext {
    return {
      variables: this.variables,
      deckId: this.deckId,
      button: { id: button.id, key: button.key },
      location: this.location ?? { folderId: '', pageId: '' },
      profileId: this.profile?.id ?? '',
      openFolder: (folderId) => this.openFolder(folderId),
      goToPage: (pageId) => this.goToPage(pageId),
      goUp: () => this.goUp(),
      goHome: () => this.goHome(),
      goBack: () => this.goBack(),
      setButtonState: (buttonId, stateId) => this.setButtonState(buttonId, stateId),
      // Attributed to the action rather than to a plugin: it was a key press,
      // and that is the useful answer to "who changed this".
      setWidgetParam: (buttonId, name, value) =>
        this.setWidgetParam(buttonId, name, value, 'vars.set-widget-param'),
      // Without an id вЂ” or with `this_btn` вЂ” the button running the script,
      // which is what a condition about "this key" means.
      buttonState: (buttonId) => {
        const target = this.buttonAsked(buttonId, button);
        return target ? this.resolveState(target).id : undefined;
      },
      widgetParam: (buttonId, name) =>
        this.widgetParamOf(this.buttonAsked(buttonId, button)?.id ?? button.id, name),
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
   * pass serialized every visual in full, data URLs included вЂ” 31ms of blocked
   * event loop on a panel-wide GIF, paid on every variable change, warm cache
   * or not.
   */
  private async paint(): Promise<void> {
    // Asked for before the scene is built, and all at once.
    //
    // Drawing is the plugin's work and therefore asynchronous, while building
    // a scene is a synchronous walk of the page вЂ” so the pictures are gathered
    // first and the walk reads what came back. It also means a page with four
    // live keys asks four plugins in parallel rather than one after another.
    await this.gatherSurfaces();

    const scene = this.buildScene();
    if (!scene) return;

    /*
     * Two things decide whether this pass is worth anything: the picture, and
     * which state each key is in.
     *
     * The scene's signature covers the first. It cannot cover the second вЂ” two
     * states may look identical and differ only in what they do вЂ” and a window
     * showing which state a key is in would have gone on showing the old one.
     * The ids are a dozen short strings, so they are compared rather than the
     * views they came from.
     */
    const views = this.view();
    const signature = `${sceneSignature(scene)}|${views.map((view) => `${view.key}:${view.stateId}`).join(',')}`;
    if (signature === this.lastScene) return;
    this.lastScene = signature;

    this.surface.setDoublePressKeys?.(this.doublePressKeys());
    this.surface.setLongPressKeys?.(this.longPressKeys());
    await this.surface.present(scene);
    this.emit('painted', sceneKeys(scene, this.surface.layout.cols), views);
  }

  /**
   * The current page as regions.
   *
   * Merged pictures are claimed first, because they decide what the keys under
   * them show. Nothing here defends against two of them overlapping or one
   * running off the edge: `validateProfile` refuses both, so a profile that
   * reached this point cannot describe either.
   *
   * A covered key keeps its own label and contributes it to the region вЂ” that
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

  /**
   * The widget a button is showing, with anything laid over it applied.
   *
   * One place, so nothing downstream has to remember that the profile is not
   * the last word: the picture, the identity used for caching and what a
   * plugin is told are all worked out from the same resolved settings.
   */
  private widgetOf(button: ButtonDefinition): SurfaceSpec | undefined {
    const spec = this.resolveState(button).visual.surface;
    if (!spec) return undefined;

    const over = this.widgetOverrides.get(button.id);
    if (!over || over.size === 0) return spec;

    const params = { ...(spec.params ?? {}) };
    for (const [name, override] of over) params[name] = override.value;

    return { ...spec, params };
  }

  /** Tells the plugins what is on screen, and only when it has changed. */
  private tellWidgets(widgets: readonly WidgetOnScreen[]): void {
    const signature = JSON.stringify(widgets);
    if (signature === this.lastWidgets) return;

    this.lastWidgets = signature;
    this.emit('widgets', widgets);
  }

  /**
   * The picture a region shows: the plugin's if it answered, otherwise its own.
   *
   * A live source that produced nothing is not a failure вЂ” the player is
   * paused, OBS is closed вЂ” so the key falls back to whatever still it was
   * given, and to nothing if it was given none. That is the whole rule between
   * the two, and it is what lets a key carry something to show meanwhile.
   *
   * A parametric icon is substituted into *here*, not further down. Everything
   * after this point identifies a picture by its id, and the id is what the
   * tile cache compares вЂ” so an icon whose needle moved but whose id did not
   * would be recognised as already drawn and never repainted.
   */
  private pictureOf(visual: ButtonVisual): { image?: SceneImage } {
    const live = visual.surface ? this.drawn.get(surfaceKey(visual.surface)) : undefined;

    if (live) {
      return {
        image: {
          asset: {
            // No id from the plugin means every frame is its own picture,
            // which is right for a stream and what a graph wants.
            id: live.id ?? this.assets.id(live.source),
            source: live.source,
          },
        },
      };
    }

    return visual.icon ? { image: { asset: this.assetFor(visual.icon) } } : {};
  }

  /**
   * Asks for every live picture the current page wants.
   *
   * Only the current page, and only this deck's: a plugin drawing a graph for
   * a folder nobody has open is the waste `onWatched` exists to prevent, in
   * the one form where the answer falls out for free вЂ” nothing off screen is
   * ever asked for.
   *
   * A plugin that throws is a plugin whose key shows no picture, not a deck
   * that stops painting. The reason goes to the log through `error`, once per
   * pass rather than once per frame.
   */
  private async gatherSurfaces(): Promise<void> {
    const provider = this.surfaces;
    const page = this.currentPage;

    if (!provider || !page) {
      this.drawn.clear();
      return;
    }

    const wanted = new Map<string, SurfaceRequest>();
    const onScreen: WidgetOnScreen[] = [];

    for (const button of page.buttons) {
      const spec = this.widgetOf(button);
      if (!spec) continue;

      onScreen.push({ buttonId: button.id, type: spec.type, params: spec.params ?? {} });

      /*
       * Keyed on the *resolved* settings, so two keys showing the same graph
       * ask for it once вЂ” and two keys a macro has pointed at different
       * readings no longer count as the same, which they would if this read
       * the profile alone.
       */
      const key = surfaceKey(spec);
      const already = wanted.get(key);

      wanted.set(key, {
        type: spec.type,
        params: spec.params ?? {},
        cols: button.colSpan ?? 1,
        rows: button.rowSpan ?? 1,
        buttons: [...(already?.buttons ?? []), button.id],
      });
    }

    this.tellWidgets(onScreen);

    /*
     * Filled aside and swapped in at the end, rather than cleared first.
     *
     * `keys` reads these too вЂ” a window and a tablet are asking what the deck
     * looks like, at any moment and not only after a paint вЂ” and a map emptied
     * for the duration of the drawing is a window that catches the keys blank
     * every couple of seconds.
     */
    const fresh = new Map<string, SurfaceFrame>();

    await Promise.all(
      [...wanted].map(async ([key, request]) => {
        try {
          const frame = await provider(request);
          if (frame) fresh.set(key, frame);
        } catch (cause) {
          this.emit('error', cause instanceof Error ? cause : new Error(String(cause)));
        }
      }),
    );

    this.drawn.clear();
    for (const [key, frame] of fresh) this.drawn.set(key, frame);
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
    const alerts: { col: number; row: number }[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const key = (top + row) * gridCols + left + col;
        // The sign belongs to the key that was pressed, even when the picture
        // it sits on belongs to a merged button covering several.
        if (this.failing.has(key)) alerts.push({ col, row });

        const own = this.buttonAt(key);
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
      ...this.pictureOf(visual),
      ...(labels.length > 0 ? { labels } : {}),
      ...(alerts.length > 0 ? { alerts } : {}),
    };
  }
}
