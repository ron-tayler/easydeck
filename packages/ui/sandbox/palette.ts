import { createApp, h } from 'vue';
import type { PluginManifest } from '@easydeck/core';

import PluginList from '../src/components/PluginList.vue';
import { i18n } from '../src/i18n/index.js';
import '../src/styles.css';

/** The manifest the hardware plugin builds on a machine with two drives. */
const hardware: PluginManifest = {
  id: 'hardware',
  name: { en: 'Hardware', ru: 'Железо' },
  version: '1.0.0',
  apiVersion: 1,
  actions: [],
  presets: [
    {
      name: 'cpu',
      label: { en: 'Processor', ru: 'Процессор' },
      description: { ru: 'Нагрузка, с цветом по мере роста', en: 'Load' },
      button: {
        stateFrom: 'hw.cpu',
        states: [
          { id: 'calm', when: { max: 59 }, visual: { background: '#22303c', label: { text: '{{hw.cpu}}%' } } },
        ],
      },
    },
    {
      name: 'memory',
      label: { en: 'Memory', ru: 'Память' },
      button: {
        stateFrom: 'hw.memory',
        states: [
          { id: 'calm', when: { max: 59 }, visual: { background: '#22303c', label: { text: '{{hw.memory}}%' } } },
        ],
      },
    },
    {
      name: 'disk-c',
      label: { en: 'Disk C', ru: 'Диск C' },
      button: {
        stateFrom: 'hw.disk-c',
        states: [
          {
            id: 'hot',
            when: { min: 85 },
            visual: { background: '#7a2c2c', label: { text: 'C\n{{hw.disk-c-free}} GB' } },
          },
        ],
      },
    },
    {
      name: 'disk-d',
      label: { en: 'Disk D', ru: 'Диск D' },
      button: {
        stateFrom: 'hw.disk-d',
        states: [
          {
            id: 'calm',
            when: { max: 59 },
            visual: { background: '#22303c', label: { text: 'D\n{{hw.disk-d-free}} GB' } },
          },
        ],
      },
    },
  ],
};

const navigation: PluginManifest = {
  id: 'easydeck',
  name: { en: 'Navigation', ru: 'Навигация' },
  version: '1.0.0',
  apiVersion: 1,
  actions: [
    { type: 'easydeck.go-home', icon: 'home', label: { en: 'Home', ru: 'На главную' } },
    { type: 'easydeck.go-back', icon: 'back', label: { en: 'Back', ru: 'Назад' } },
    { type: 'easydeck.go-up', icon: 'up', label: { en: 'Up', ru: 'Вверх' } },
  ],
};

const variables = { 'hw.cpu': 18, 'hw.memory': 51, 'hw.disk-c': 87, 'hw.disk-c-free': 61.3, 'hw.disk-d': 15, 'hw.disk-d-free': 71.9 };

createApp({
  render: () =>
    h('div', { style: 'display:flex; gap:24px; height:100vh; padding:16px' }, [
      h('div', { style: 'width:320px; border:1px solid var(--border); border-radius:10px; padding:10px 0' }, [
        h('p', { style: 'margin:0 12px 8px; font-size:12px; color:var(--text-muted)' }, 'На главной: presets'),
        h(PluginList, { plugins: [hardware, navigation], presets: true, variables }),
      ]),
      h('div', { style: 'width:320px; border:1px solid var(--border); border-radius:10px; padding:10px 0' }, [
        h('p', { style: 'margin:0 12px 8px; font-size:12px; color:var(--text-muted)' }, 'В редакторе кнопки: только действия'),
        h(PluginList, { plugins: [hardware, navigation] }),
      ]),
    ]),
})
  .use(i18n)
  .mount('#app');
