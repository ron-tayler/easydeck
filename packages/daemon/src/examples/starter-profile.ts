import type { ProfileDefinition } from '@easydeck/engine';

/** A text editor that exists on the platform the daemon is running on. */
function textEditor(): { command: string; label: string } {
  if (process.platform === 'win32') return { command: 'notepad', label: 'Блокнот' };
  if (process.platform === 'darwin') return { command: 'open', label: 'Редактор' };
  return { command: 'xdg-open', label: 'Редактор' };
}

/**
 * Written to the profile directory on first run.
 *
 * Deliberately practical rather than showy: every button here does something
 * a person actually wants on day one, and the file doubles as documentation
 * of the profile format once they open it in an editor.
 *
 * Only actions known to work are used. Keyboard emulation is deliberately
 * absent — see the known issues in the README — because a starter profile
 * with a dead button reads as a broken program.
 */
export function createStarterProfile(configDirectory: string): ProfileDefinition {
  const editor = textEditor();

  return {
    id: 'starter',
    name: 'Starter',
    layout: { rows: 3, cols: 5 },
    initialPageId: 'main',
    variables: { clicks: 0, bright: 'normal' },
    pages: [
      {
        id: 'main',
        name: 'Главная',
        buttons: [
          {
            id: 'browser',
            key: 0,
            states: [
              {
                id: 'default',
                visual: { background: '#1f4e79', label: { text: 'Браузер', fontSize: 16 } },
                actions: { up: [{ type: 'open', params: { target: 'https://github.com' } }] },
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
                actions: { up: [{ type: 'run-program', params: { command: editor.command } }] },
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
                actions: { up: [{ type: 'open', params: { target: configDirectory } }] },
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
                  up: [{ type: 'increment-variable', params: { name: 'clicks' } }],
                  longPress: [{ type: 'set-variable', params: { name: 'clicks', value: 0 } }],
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
                  up: [
                    { type: 'set-brightness', params: { percent: 100 } },
                    { type: 'set-variable', params: { name: 'bright', value: 'high' } },
                  ],
                },
              },
              {
                id: 'high',
                visual: { background: '#5f7f7f', label: { text: 'Тусклее', fontSize: 15 } },
                actions: {
                  up: [
                    { type: 'set-brightness', params: { percent: 40 } },
                    { type: 'set-variable', params: { name: 'bright', value: 'normal' } },
                  ],
                },
              },
            ],
          },
          {
            id: 'to-tools',
            key: 14,
            states: [
              {
                id: 'default',
                visual: {
                  background: '#3a3d40',
                  label: { text: 'Ещё >', fontSize: 15, color: '#9ad1ff' },
                },
                actions: { up: [{ type: 'go-to-page', params: { pageId: 'tools' } }] },
              },
            ],
          },
        ],
      },
      {
        id: 'tools',
        name: 'Инструменты',
        buttons: [
          {
            id: 'sleep',
            key: 0,
            states: [
              {
                id: 'default',
                visual: { background: '#26262b', label: { text: 'Сон', fontSize: 16 } },
                actions: { up: [{ type: 'sleep-panel' }] },
              },
            ],
          },
          {
            id: 'status',
            key: 2,
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
            id: 'back',
            key: 14,
            states: [
              {
                id: 'default',
                visual: {
                  background: '#3a3d40',
                  label: { text: '< Назад', fontSize: 15, color: '#9ad1ff' },
                },
                actions: { up: [{ type: 'go-to-page', params: { pageId: 'main' } }] },
              },
            ],
          },
        ],
      },
    ],
  };
}
