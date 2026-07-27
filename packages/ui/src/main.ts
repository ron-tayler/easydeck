import { createApp } from 'vue';

import App from './App.vue';
import { i18n } from './i18n/index.js';
import './styles.css';

document.documentElement.lang = i18n.global.locale.value;

createApp(App).use(i18n).mount('#app');
