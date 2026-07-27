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
import { VariableStore } from '../domain/variables.js';
import type { VariableValue } from '../domain/variables.js';
import type { ButtonVisual } from '../domain/visual.js';
import type { ActionRegistry } from './action-registry.js';
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
    // Force a full repaint: the new profile may reuse keys with the same
    // visuals, and stale bookkeeping would skip writing them.
    this.painted.clear();
    this.location = this.initialLocation(profile, this.tree);

    for (const [name, value] of Object.entries(profile.variables ?? {})) {
      this.variables.set(name, value);
    }
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
    if (button.stateFrom) this.variables.set(button.stateFrom, stateId);
    else this.stateOverrides.set(buttonId, stateId);

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

    return [...page.buttons]
      .sort((a, b) => a.key - b.key)
      .map((button) => ({
        key: button.key,
        buttonId: button.id,
        stateId: this.resolveState(button).id,
        visual: this.resolveVisual(button),
      }));
  }

  /** Forces every key to be rewritten on the next pass. */
  invalidate(): void {
    this.painted.clear();
    this.requestPaint();
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
      const wanted = this.variables.get(button.stateFrom);
      const bound = button.states.find((state) => state.id === String(wanted));
      if (bound) return bound;
    }

    const override = this.stateOverrides.get(button.id);
    const explicit = button.states.find((state) => state.id === override);
    if (explicit) return explicit;

    const initial = button.states.find((state) => state.id === button.initialStateId);
    return initial ?? button.states[0]!;
  }

  private resolveVisual(button: ButtonDefinition): ButtonVisual {
    const { visual } = this.resolveState(button);
    if (!visual.label) return visual;

    const snapshot: Record<string, VariableValue> = this.variables.snapshot();
    return { ...visual, label: { ...visual.label, text: renderTemplate(visual.label.text, snapshot) } };
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

    for (let key = 0; key < rows * cols; key++) {
      const button = page.buttons.find((candidate) => candidate.key === key);

      if (!button) {
        if (!this.painted.has(key)) continue;
        await this.surface.clearKey(key);
        this.painted.delete(key);
        written.push(key);
        continue;
      }

      const visual = this.resolveVisual(button);
      const signature = JSON.stringify(visual);
      if (this.painted.get(key) === signature) continue;

      const image = await this.renderer.render(visual);
      await this.surface.setKeyImage(key, image);
      // Recorded only after a successful write, so a failed key is retried.
      this.painted.set(key, signature);
      written.push(key);
    }

    if (written.length > 0) this.emit('painted', written);
  }
}
