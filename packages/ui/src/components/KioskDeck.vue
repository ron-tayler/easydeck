<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { GestureRecognizer } from '@easydeck/engine';
import type { ButtonEvent } from '@easydeck/engine';
import type { KeyView } from '@easydeck/protocol';

import DeckKey from './DeckKey.vue';
import { lastError } from '../composables/useDeck.js';
import {
  createClient,
  deviceName,
  forgetDeviceIdentity,
  rememberDeviceToken,
  setDeviceName,
} from '../api/client.js';

/**
 * This page, acting as a deck.
 *
 * Everything a panel does, done in a browser: it shows the keys, it decides
 * for itself whether a touch was a tap, a hold or a double press, and it sends
 * the finished gesture. Recognising locally is what keeps a slow link from
 * turning a double tap into two singles — and it is why several keys can be
 * held at once here, which the panel's own matrix cannot manage.
 *
 * Nothing is composed or encoded for this deck: it is sent the scene and draws
 * it with the same component the configurator previews with, so a stretched
 * animation costs one description and one download of the picture.
 */

const { t } = useI18n();
const client = createClient();

const rows = ref(3);
const cols = ref(5);
const keys = ref<readonly KeyView[]>([]);
const pressed = ref<ReadonlySet<number>>(new Set());
const deckId = ref<string | undefined>();
/**
 * The code the daemon issued for this device, if it issued one.
 *
 * Only ever set from what the daemon sent. A code invented locally, or one
 * left on screen after the request was refused, would be a number the user
 * cannot find anywhere — the worst possible thing to show beside the word
 * "approve".
 */
const waitingCode = ref<string | undefined>();
/** Why the daemon will not talk to this page, in its own words. */
const refusal = ref<string | undefined>();
const connected = ref(false);

const slots = computed(() => Array.from({ length: rows.value * cols.value }, (_, index) => index));
const byKey = computed(() => new Map(keys.value.map((view) => [view.key, view])));

/**
 * The area actually visible, which on a tablet is not the window.
 *
 * A browser's own chrome — address bar, tab strip, the bar that slides back in
 * when you touch near the edge — is counted by `100vh` but cannot be seen, so a
 * grid sized against it puts its bottom row underneath. `visualViewport` is the
 * part of the page the user can really look at; sizing to that costs a margin
 * at the sides and gains a deck whose last row is reachable.
 */
const view = ref({ width: 0, height: 0 });

function measure(): void {
  const visual = window.visualViewport;
  view.value = {
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
  };
}

/** Every key the same size, as many as fit, centred with room to spare. */
const grid = computed(() => {
  const { width, height } = view.value;
  if (!width || !height) return undefined;

  const margin = Math.round(Math.min(width, height) * 0.02);
  const gap = margin;
  const cell = Math.floor(
    Math.min(
      (width - margin * 2 - gap * (cols.value - 1)) / cols.value,
      (height - margin * 2 - gap * (rows.value - 1)) / rows.value,
    ),
  );

  return {
    gap: `${gap}px`,
    gridTemplateColumns: `repeat(${cols.value}, ${Math.max(cell, 1)}px)`,
    gridTemplateRows: `repeat(${rows.value}, ${Math.max(cell, 1)}px)`,
  };
});

/**
 * The way out, sized against the screen rather than in fixed pixels.
 *
 * A fixed size cannot suit both: the same 28 px that looked right on a phone
 * was a speck on a tablet, and the four-times-larger button that fixed the
 * tablet swallowed a phone. Measured against the shorter side of the visible
 * area it stays roughly the same fraction of the deck everywhere, with limits
 * so it never falls below a fingertip or grows into a key.
 */
const fullscreenSize = computed(() => {
  const shorter = Math.min(view.value.width, view.value.height);
  return Math.round(Math.min(80, Math.max(34, shorter * 0.08)));
});

const fullscreenStyle = computed(() => ({
  width: `${fullscreenSize.value}px`,
  height: `${fullscreenSize.value}px`,
  fontSize: `${Math.round(fullscreenSize.value * 0.5)}px`,
  borderRadius: `${Math.round(fullscreenSize.value * 0.12)}px`,
}));

const fullscreen = ref(false);

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') releaseAll();
}

function noteFullscreen(): void {
  fullscreen.value = document.fullscreenElement !== null;
  // Entering or leaving changes what can be seen, and the grid follows.
  measure();
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
    return;
  }

  // Refused on some browsers unless it comes straight from a tap, which is
  // exactly where this is called from.
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

/** Turns the daemon's cause into something a person can read. */
function reasonText(reason: string | undefined): string {
  if (reason === 'networkDecksOff') return t('deckMode.decksOff');
  if (reason === 'notAccepted') return t('deckMode.refused');
  return reason ?? t('deckMode.refused');
}

const recognizer = new GestureRecognizer((key, gesture: ButtonEvent) => {
  void client.call('deckGesture', { key, gesture }).catch(reattachIfDetached);
});

/**
 * Recovers a deck the daemon no longer has.
 *
 * The belt to the reconnect's braces: whatever the reason the deck went away
 * — a dropped socket, a daemon restarted underneath us — a gesture that comes
 * back saying so gets the deck built again rather than silently doing nothing.
 */
async function reattachIfDetached(error: unknown): Promise<void> {
  if (!(error instanceof Error) || error.message !== 'deckDetached') return;

  deckId.value = undefined;
  await attach().catch(() => undefined);
}

async function attach(): Promise<void> {
  const result = await client.call<{ deckId: string }>('attachDeck', {
    rows: rows.value,
    cols: cols.value,
    name: deviceName(),
  });

  deckId.value = result.deckId;
  await refresh();
}

async function refresh(): Promise<void> {
  if (!deckId.value) return;

  const result = await client.call<{ keys: KeyView[] }>('getPageView', { deckId: deckId.value });
  keys.value = result.keys;
}

function press(key: number, event: PointerEvent): void {
  /*
   * The key keeps the pointer until it is let go.
   *
   * Without capture a release that lands anywhere else — the browser decided
   * the hold was a long-press menu, the finger drifted a pixel onto the gap
   * between keys — never reaches the key it started on, which stays down for
   * good and swallows every gesture after it.
   */
  const target = event.currentTarget;
  if (target instanceof Element && 'setPointerCapture' in target) {
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Some browsers refuse for a pointer that has already ended; the
      // window-level release below is the fallback.
    }
  }

  const next = new Set(pressed.value);
  next.add(key);
  pressed.value = next;

  recognizer.down(key);
  void client.call('deckPressed', { key, pressed: true }).catch(reattachIfDetached);
}

function release(key: number): void {
  if (!pressed.value.has(key)) return;

  const next = new Set(pressed.value);
  next.delete(key);
  pressed.value = next;

  recognizer.up(key);
  void client.call('deckPressed', { key, pressed: false }).catch(reattachIfDetached);
}

/**
 * Lets go of everything still held.
 *
 * For the cases where the release never arrives as an event on the key: the
 * page went to the background mid-hold, the browser took the gesture for
 * itself, the tablet was locked. A key that stays down is not just wrong on
 * screen — the daemon is still being told it is held.
 */
function releaseAll(): void {
  for (const key of pressed.value) release(key);
}

onMounted(() => {
  measure();
  // The visible area changes without the window doing so: a bar slides away,
  // the keyboard closes, fullscreen is entered.
  window.visualViewport?.addEventListener('resize', measure);
  window.visualViewport?.addEventListener('scroll', measure);
  window.addEventListener('resize', measure);
  document.addEventListener('fullscreenchange', noteFullscreen);
  window.addEventListener('pointerup', releaseAll);
  window.addEventListener('pointercancel', releaseAll);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibilityChange);

  client.onConnected((value) => {
    // Losing the socket says nothing about being approved, so whatever is on
    // screen — a code, a reason — stays until the daemon says otherwise.
    connected.value = value;
    if (value) return;

    /*
     * The deck belonged to that connection and died with it.
     *
     * The daemon drops a network deck when its socket closes, so after a
     * reconnect there is nothing on the other end to receive a press: the
     * grid still draws, every gesture is answered, and nothing happens —
     * which reads as the page having frozen. Forgetting the deck here is
     * what makes the next snapshot attach a new one.
     *
     * A finger that was down when the link broke is forgotten too, or the
     * key it was on would stay pressed forever.
     */
    deckId.value = undefined;
    pressed.value = new Set();
    recognizer.reset();
  });

  /*
   * The deck is claimed only once the daemon has accepted this device.
   *
   * Asking earlier is how the code used to vanish: an unapproved connection
   * answers "waiting to be approved", and that answer arrived as an error just
   * after the code did — replacing the one screen that told the user what to
   * do with a sentence saying the same thing, minus the number.
   *
   * A snapshot of the state is the daemon's way of saying "you are in".
   */
  client.on('state', () => {
    if (deckId.value) return;

    refusal.value = undefined;
    waitingCode.value = undefined;
    void attach().catch((error: unknown) => {
      // Decks over the network can still be switched off, and that is worth
      // saying rather than sitting on an empty grid.
      refusal.value = reasonText(error instanceof Error ? error.message : undefined);
    });
  });

  client.on('devicePending', (payload) => {
    // Nothing to show but the code: the daemon will not talk to this page
    // until someone matches it against the number in the configurator.
    refusal.value = undefined;
    waitingCode.value = (payload as { code?: string }).code;
  });

  client.on('deviceRejected', (payload) => {
    const reason = (payload as { reason?: string }).reason;

    if (reason === 'idTaken') {
      // Someone already holds this identity and we cannot prove it is us.
      // Becoming a new device is the only way forward, and it costs one
      // approval rather than an unanswerable request.
      forgetDeviceIdentity();
      window.location.reload();
      return;
    }

    // No queue was joined, so there is no code to show — only the reason,
    // translated here: the daemon sends a cause, not a sentence.
    waitingCode.value = undefined;
    refusal.value = reasonText(reason);
  });

  client.on('deviceApproved', (payload) => {
    // Approved while watching: the code has served its purpose.
    waitingCode.value = undefined;
    rememberDeviceToken((payload as { token: string }).token);
    // Reloading is the simplest way to come back as an approved device: the
    // socket authenticates once, at the handshake.
    window.location.reload();
  });

  /*
   * The scene arrives as a signal rather than as something to draw directly:
   * the keys are then fetched already resolved, with the same shape the
   * configurator renders, so there is one drawing path instead of two.
   *
   * And it is the only signal worth fetching on. A variable moving used to
   * fetch as well, which meant a page over Wi-Fi asked for all fifteen keys a
   * couple of times a second because a processor gauge had ticked — for keys
   * that had not changed, since a variable that changes the picture makes the
   * deck repaint, and a repaint is a scene.
   */
  client.on('scene', () => void refresh());
});

onBeforeUnmount(() => {
  recognizer.reset();
  window.visualViewport?.removeEventListener('resize', measure);
  window.visualViewport?.removeEventListener('scroll', measure);
  window.removeEventListener('resize', measure);
  document.removeEventListener('fullscreenchange', noteFullscreen);
  window.removeEventListener('pointerup', releaseAll);
  window.removeEventListener('pointercancel', releaseAll);
  window.removeEventListener('blur', releaseAll);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

function rename(): void {
  const name = window.prompt(t('deckMode.namePrompt'), deviceName());
  if (!name) return;

  setDeviceName(name);
  window.location.reload();
}
</script>

<template>
  <div class="kiosk" :style="{ width: `${view.width}px`, height: `${view.height}px` }">
    <!-- Above everything, including a key it happens to sit on: without it a
         deck in a browser has no way back out of the browser. -->
    <button
      type="button"
      class="fullscreen"
      :style="fullscreenStyle"
      :title="fullscreen ? t('deckMode.exitFullscreen') : t('deckMode.fullscreen')"
      :aria-label="fullscreen ? t('deckMode.exitFullscreen') : t('deckMode.fullscreen')"
      @click="toggleFullscreen"
    >
      {{ fullscreen ? '⤡' : '⤢' }}
    </button>

    <!-- Otherwise a throw in a component is invisible here: the grid keeps
         drawing, presses go nowhere, and it reads as the page having hung. -->
    <p v-if="lastError" class="failure" @click="lastError = undefined">{{ lastError }}</p>

    <div v-if="refusal" class="waiting">
      <h1>{{ t('deckMode.notAvailable') }}</h1>
      <p class="hint">{{ refusal }}</p>
      <p class="hint">{{ t('deckMode.enableHint') }}</p>
    </div>

    <div v-else-if="waitingCode" class="waiting">
      <h1>{{ t('deckMode.waiting') }}</h1>
      <p class="code">{{ waitingCode }}</p>
      <p class="hint">{{ t('deckMode.waitingHint') }}</p>
      <button type="button" @click="rename">{{ t('deckMode.rename') }}</button>
    </div>

    <div v-else-if="!connected" class="waiting">
      <h1>{{ t('status.connecting') }}</h1>
    </div>

    <div
      v-else
      class="grid"
      :style="grid"
      @contextmenu.prevent
    >
      <DeckKey
        v-for="index in slots"
        :key="index"
        :index="index"
        :view="byKey.get(index)"
        :pressed="pressed.has(index)"
        :selected="false"
        :fixed="true"
        @pointerdown="press(index, $event)"
        @pointerup="release(index)"
        @pointercancel="release(index)"
        @lostpointercapture="release(index)"
        @contextmenu.prevent
      />
    </div>
  </div>
</template>

<style scoped>
.kiosk {
  /* Pinned to the top-left of what is visible, sized in pixels rather than
     viewport units — the two differ by exactly the browser's own chrome. */
  position: fixed;
  top: 0;
  left: 0;
  display: grid;
  place-items: center;
  background: #05070a;
  /* A deck is touched, not read: nothing here should select or bounce. */
  user-select: none;
  touch-action: manipulation;
  overscroll-behavior: none;
  /* A long press on a picture otherwise opens the browser's own menu, which
     eats the gesture and leaves the key believing it is still held. */
  -webkit-touch-callout: none;
}

.grid {
  /* Sized in script, against the visible area: the keys are square and the
     whole panel fits, with the leftover space falling to the sides. */
  display: grid;
}

.fullscreen {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 10;
  /* Size comes from script: it scales with the visible area, since a phone and
     a tablet do not agree on what "small" means. */
  padding: 0;
  border: none;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  /* Small and dim on purpose: it is a way out, not part of the deck. */
  opacity: 0.55;
  cursor: pointer;
}

.fullscreen:hover,
.fullscreen:active {
  opacity: 1;
}

.failure {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 11;
  margin: 0;
  padding: 8px 12px;
  font-size: 13px;
  color: #fff;
  background: #7f1d1d;
  cursor: pointer;
}

.waiting {
  text-align: center;
  color: var(--text);
  padding: 24px;
}

.code {
  font-size: 15vmin;
  letter-spacing: 0.1em;
  font-variant-numeric: tabular-nums;
  margin: 12px 0;
}

.hint {
  color: var(--muted);
  max-width: 32ch;
  margin: 0 auto 24px;
}
</style>
