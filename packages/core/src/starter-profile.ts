import { PROFILE_FORMAT_VERSION } from '@easydeck/engine';
import type { ProfileDefinition } from '@easydeck/engine';

/** A text editor that exists on the platform the app is running on. */
function textEditor(): { command: string; label: string } {
  if (process.platform === 'win32') return { command: 'notepad', label: 'Блокнот' };
  if (process.platform === 'darwin') return { command: 'open', label: 'Редактор' };
  return { command: 'xdg-open', label: 'Редактор' };
}

/**
 * Written to the profile directory on first run.
 *
 * Deliberately practical rather than showy: every button does something a
 * person actually wants on day one, and the file doubles as documentation of
 * the profile format once they open it in an editor. It also shows both ways
 * of organising a deck — a second page of the same scene, and a nested scene
 * entered from a button.
 *
 * Only actions known to work are used. Keyboard emulation is deliberately
 * absent — see the known issues in the README — because a starter profile
 * with a dead button reads as a broken program.
 */
export function createStarterProfile(configDirectory: string): ProfileDefinition {
  const editor = textEditor();

  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: 'starter',
    name: 'Starter',
    layout: { rows: 3, cols: 5 },
    variables: [
      { name: 'clicks', type: 'number', initial: 0 },
      {
        name: 'bright',
        type: 'enum',
        initial: 'normal',
        options: [{ value: 'normal' }, { value: 'bright' }],
      },
    ],
    root: {
      id: 'root',
      name: 'Главная',
      pages: [
        {
          id: 'main',
          name: 'Основное',
          buttons: [
            {
              id: 'browser',
              key: 0,
              states: [
                {
                  id: 'default',
                  visual: { background: '#1f4e79', label: { text: 'Браузер', fontSize: 16 } },
                  actions: { press: [{ type: 'system.open', params: { target: 'https://github.com' } }] },
                },
              ],
            },
            {
              id: 'editor',
              key: 1,
              states: [
                {
                  id: 'default',
                  visual: { background: '#4a4a2d', label: { text: editor.label, fontSize: 16 } },
                  actions: {
                    press: [{ type: 'system.run-program', params: { command: editor.command } }],
                  },
                },
              ],
            },
            {
              // The most useful button a newcomer can have: it opens the folder
              // holding this very file, so the profile is easy to find and edit.
              id: 'profiles-folder',
              key: 2,
              states: [
                {
                  id: 'default',
                  visual: { background: '#3d3d5c', label: { text: 'Профили', fontSize: 15 } },
                  actions: { press: [{ type: 'system.open', params: { target: configDirectory } }] },
                },
              ],
            },
            {
              id: 'counter',
              key: 4,
              states: [
                {
                  id: 'default',
                  visual: {
                    background: '#20242b',
                    label: { text: '{{clicks}}', fontSize: 40, color: '#ffd166' },
                  },
                  actions: {
                    press: [{ type: 'vars.increment-variable', params: { name: 'clicks' } }],
                    longPress: [
                      { type: 'vars.set-variable', params: { name: 'clicks', value: 0 } },
                    ],
                  },
                },
              ],
            },
            {
              id: 'brightness',
              key: 5,
              stateFrom: 'bright',
              states: [
                {
                  id: 'normal',
                  visual: { background: '#2f4f4f', label: { text: 'Ярче', fontSize: 16 } },
                  actions: {
                    press: [
                      { type: 'deck.set-brightness', params: { percent: 100 } },
                      { type: 'vars.set-variable', params: { name: 'bright', value: 'high' } },
                    ],
                  },
                },
                {
                  id: 'high',
                  visual: { background: '#5f7f7f', label: { text: 'Тусклее', fontSize: 15 } },
                  actions: {
                    press: [
                      { type: 'deck.set-brightness', params: { percent: 40 } },
                      { type: 'vars.set-variable', params: { name: 'bright', value: 'normal' } },
                    ],
                  },
                },
              ],
            },
            {
              // Same scene, second screen — cheaper than a folder when all you
              // needed was more room.
              id: 'to-page-2',
              key: 9,
              states: [
                {
                  id: 'default',
                  visual: {
                    background: '#2a2f38',
                    label: { text: 'Стр. 2 >', fontSize: 14, color: '#9ad1ff' },
                  },
                  actions: { press: [{ type: 'easydeck.go-to-page', params: { pageId: 'main-2' } }] },
                },
              ],
            },
            {
              // A different scene, entered like a folder.
              id: 'to-tools',
              key: 14,
              states: [
                {
                  id: 'default',
                  visual: {
                    background: '#3a3d40',
                    label: { text: 'Инструменты', fontSize: 13, color: '#9ad1ff' },
                  },
                  actions: { press: [{ type: 'easydeck.open-folder', params: { folderId: 'tools' } }] },
                },
              ],
            },
          ],
        },
        {
          id: 'main-2',
          name: 'Ещё',
          buttons: [
            {
              id: 'status',
              key: 0,
              states: [
                {
                  id: 'default',
                  visual: {
                    background: '#0f4c5c',
                    label: { text: 'Нажатий: {{clicks}}', fontSize: 13 },
                  },
                },
              ],
            },
            {
              id: 'to-page-1',
              key: 9,
              states: [
                {
                  id: 'default',
                  visual: {
                    background: '#2a2f38',
                    label: { text: '< Стр. 1', fontSize: 14, color: '#9ad1ff' },
                  },
                  actions: { press: [{ type: 'easydeck.go-to-page', params: { pageId: 'main' } }] },
                },
              ],
            },
          ],
        },
      ],
      folders: [
        {
          id: 'tools',
          name: 'Инструменты',
          pages: [
            {
              id: 'tools-main',
              buttons: [
                {
                  id: 'sleep',
                  key: 0,
                  states: [
                    {
                      id: 'default',
                      visual: { background: '#26262b', label: { text: 'Сон', fontSize: 16 } },
                      actions: { press: [{ type: 'deck.sleep-panel' }] },
                    },
                  ],
                },
                {
                  id: 'up',
                  key: 14,
                  states: [
                    {
                      id: 'default',
                      visual: {
                        background: '#3a3d40',
                        label: { text: '< Наверх', fontSize: 14, color: '#9ad1ff' },
                      },
                      actions: { press: [{ type: 'easydeck.go-up' }] },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
