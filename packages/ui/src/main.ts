import { createApp } from 'vue';
import dejaVuSans from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';

import App from './App.vue';
import KioskDeck from './components/KioskDeck.vue';
import { resolveMode } from './api/client.js';
import { lastError } from './composables/useDeck.js';
import { i18n } from './i18n/index.js';
import './styles.css';

document.documentElement.lang = i18n.global.locale.value;

/**
 * The very font the device draws with.
 *
 * Key previews were rendering in the system UI font, whose metrics differ
 * from DejaVu's, so the same nominal size looked a couple of pixels larger
 * than what the panel shows. Loading the real thing makes the preview
 * faithful rather than approximately right — the alternative was a fudge
 * factor that would drift the moment either side changed.
 */
const keyFont = new FontFace('EasyDeck Sans', `url(${dejaVuSans})`);
document.fonts.add(keyFont);
void keyFont.load();

/**
 * Puts a fatal failure on screen.
 *
 * A page that dies before it mounts shows its background and nothing else,
 * which tells the person holding the tablet nothing and whoever has to fix it
 * barely more. Anything fatal is written out instead — the difference between
 * "it is broken" and "here is what broke".
 */
function showFailure(error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  document.body.innerHTML = '';

  const box = document.createElement('pre');
  box.style.cssText =
    'margin:0;padding:24px;font:14px/1.5 ui-monospace,monospace;color:#e6edf3;white-space:pre-wrap';
  box.textContent = message;
  document.body.appendChild(box);
}

window.addEventListener('error', (event) => showFailure(event.error ?? event.message));

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  lastError.value = event.reason instanceof Error ? event.reason.message : String(event.reason);
});

function start(root: Parameters<typeof createApp>[0]): void {
  const app = createApp(root);

  /**
   * Surfaces component errors instead of letting them vanish into the console.
   *
   * Vue swallows a throw during render or in a handler and carries on, which
   * looks exactly like "I clicked and nothing happened" — the hardest symptom
   * to diagnose and the easiest to prevent.
   */
  app.config.errorHandler = (error) => {
    console.error(error);
    lastError.value = error instanceof Error ? error.message : String(error);
  };

  app.use(i18n).mount('#app');
}

/*
 * One bundle, two things it can be — and which one is not this page's choice.
 * The daemon says: anything it serves over HTTP is a deck, while the desktop
 * window is the configurator.
 *
 * Started from a promise rather than a top-level await: that syntax needs a
 * module loader newer than some tablets have, and a browser that cannot parse
 * the entry point runs none of it — including the code that would have
 * explained why.
 */
void resolveMode()
  .then((mode) => start(mode === 'deck' ? KioskDeck : App))
  .catch(showFailure);
