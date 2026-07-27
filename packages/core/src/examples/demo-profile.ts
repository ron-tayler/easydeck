import type { ProfileDefinition } from '@easydeck/engine';

/**
 * A profile exercising everything the engine currently offers, written the
 * way a stored JSON document will look.
 *
 * Note that nothing here is code: multi-state buttons, variable-driven
 * appearance, counters and page navigation are all declarative. That is the
 * point of the engine zone.
 */
export const DEMO_PROFILE: ProfileDefinition = {
  id: 'demo',
  name: 'EasyDeck demo',
  layout: { rows: 3, cols: 5 },
  initialPageId: 'main',
  variables: { micOn: 'on', scene: 'first', clicks: 0 },
  pages: [
    {
      id: 'main',
      name: 'Главная',
      buttons: [
        {
          // Bound to a variable, so it follows the mic even if something
          // other than this button changes it.
          id: 'mic',
          key: 0,
          stateFrom: 'micOn',
          states: [
            {
              id: 'on',
              visual: { background: '#1d7a3c', label: { text: 'Мик вкл', fontSize: 16 } },
              actions: { up: [{ type: 'set-variable', params: { name: 'micOn', value: 'off' } }] },
            },
            {
              id: 'off',
              visual: { background: '#8a1f1f', label: { text: 'Мик выкл', fontSize: 16 } },
              actions: { up: [{ type: 'set-variable', params: { name: 'micOn', value: 'on' } }] },
            },
          ],
        },
        {
          // Three appearances cycled by one action.
          id: 'scene',
          key: 1,
          stateFrom: 'scene',
          states: [
            { id: 'first', visual: { background: '#264653', label: { text: 'Сцена 1', fontSize: 17 } } },
            { id: 'second', visual: { background: '#2a6f6f', label: { text: 'Сцена 2', fontSize: 17 } } },
            { id: 'third', visual: { background: '#3d8168', label: { text: 'Сцена 3', fontSize: 17 } } },
          ],
          initialStateId: 'first',
        },
        {
          id: 'next-scene',
          key: 2,
          states: [
            {
              id: 'default',
              visual: { background: '#4a2d6b', label: { text: 'Сцена >', fontSize: 17 } },
              actions: {
                up: [
                  {
                    type: 'cycle-variable',
                    params: { name: 'scene', values: ['first', 'second', 'third'] },
                  },
                ],
              },
            },
          ],
        },
        {
          // A label that interpolates a variable, plus long press to reset.
          id: 'counter',
          key: 4,
          states: [
            {
              id: 'default',
              visual: { background: '#20242b', label: { text: '{{clicks}}', fontSize: 40, color: '#ffd166' } },
              actions: {
                // On release, so holding to reset does not also count a click.
                up: [{ type: 'increment-variable', params: { name: 'clicks' } }],
                longPress: [{ type: 'set-variable', params: { name: 'clicks', value: 0 } }],
              },
            },
          ],
        },
        {
          id: 'to-second',
          key: 14,
          states: [
            {
              id: 'default',
              visual: { background: '#3a3d40', label: { text: 'Стр. 2 >', fontSize: 15, color: '#9ad1ff' } },
              actions: { up: [{ type: 'go-to-page', params: { pageId: 'second' } }] },
            },
          ],
        },
      ],
    },
    {
      id: 'second',
      name: 'Вторая',
      buttons: [
        {
          id: 'status',
          key: 0,
          states: [
            {
              id: 'default',
              visual: { background: '#0f4c5c', label: { text: 'Нажатий: {{clicks}}', fontSize: 14 } },
            },
          ],
        },
        {
          id: 'back',
          key: 14,
          states: [
            {
              id: 'default',
              visual: { background: '#3a3d40', label: { text: '< Назад', fontSize: 15, color: '#9ad1ff' } },
              actions: { up: [{ type: 'go-to-page', params: { pageId: 'main' } }] },
            },
          ],
        },
      ],
    },
  ],
};
