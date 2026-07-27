import { createApp } from 'vue';
import dejaVuSans from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';

import App from './App.vue';
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

const app = createApp(App);

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

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  lastError.value =
    event.reason instanceof Error ? event.reason.message : String(event.reason);
});

app.use(i18n).mount('#app');
