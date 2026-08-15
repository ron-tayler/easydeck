import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROFILE_FORMAT_VERSION } from '@easydeck/engine';

import { migrateProfile } from './migrate-profile.js';

/**
 * A version 6 profile using the four plugins that later moved out, in every
 * way a profile can use one: an action, a widget, a binding, a condition, an
 * icon's variable and a label's template.
 */
function profileFromV6() {
  return {
    formatVersion: 6,
    id: 'test',
    name: 'Test',
    layout: { rows: 2, cols: 3 },
    root: {
      id: 'root',
      name: 'Root',
      pages: [
        {
          id: 'main',
          name: 'Main',
          buttons: [
            {
              id: 'scene',
              key: 0,
              stateFrom: 'obs.scene',
              states: [
                {
                  id: 'default',
                  visual: {
                    surface: { type: 'obs.thumbnail', params: { source: '@program' } },
                    label: { text: '{{ obs.scene }} / {{yandex.title}}' },
                    icon: {
                      source: 'x.svg',
                      params: { level: { variable: 'soundpad.position', from: 0, to: 100 } },
                    },
                  },
                  actions: {
                    press: [
                      { type: 'obs.set-scene', params: { scene: 'Game' } },
                      {
                        type: 'core.on',
                        params: { source: 'variable', name: 'vts.tracking', operator: '=', value: true },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('migrating to version 7', () => {
  it('renames the four evicted plugins wherever a profile can hold them', () => {
    const profile = migrateProfile(profileFromV6());
    const button = profile.root.pages[0]!.buttons[0]! as unknown as Record<string, unknown>;
    const state = (button['states'] as Record<string, unknown>[])[0]!;
    const visual = state['visual'] as Record<string, Record<string, unknown>>;
    const press = (state['actions'] as { press: Record<string, unknown>[] }).press;

    assert.equal(profile.formatVersion, PROFILE_FORMAT_VERSION);
    assert.equal(button['stateFrom'], 'ed.obs.scene');
    assert.equal(visual['surface']!['type'], 'ed.obs.thumbnail');
    // Spacing inside the braces survives; both plugins in one label rename.
    assert.equal((visual['label'] as { text: string }).text, '{{ ed.obs.scene }} / {{ed.yandex.title}}');
    assert.equal(
      ((visual['icon'] as { params: { level: { variable: string } } }).params).level.variable,
      'ed.soundpad.position',
    );
    assert.equal(press[0]!['type'], 'ed.obs.set-scene');
    // A condition keeps its variable under `name`, told apart by `source`.
    assert.equal((press[1]!['params'] as { name: string }).name, 'ed.vts.tracking');
  });

  it('leaves what merely resembles a plugin alone', () => {
    const raw = profileFromV6();
    raw.root.pages[0]!.name = 'yandex.ru links';
    (raw.root.pages[0]!.buttons[0]!.states[0]!.actions!.press![0] as Record<string, unknown>)[
      'params'
    ] = { scene: 'obs. мой пресет', url: 'https://yandex.ru' };

    const profile = migrateProfile(raw);
    const page = profile.root.pages[0]! as unknown as Record<string, unknown>;
    const press = ((profile.root.pages[0]!.buttons[0]!.states[0]! as unknown as Record<string, unknown>)[
      'actions'
    ] as { press: { params: Record<string, string> }[] }).press;

    // A page's name is somebody's name for a page, not a reference.
    assert.equal(page['name'], 'yandex.ru links');
    // Param values are not rewritten: a scene name is OBS's, not ours.
    assert.equal(press[0]!.params['scene'], 'obs. мой пресет');
    assert.equal(press[0]!.params['url'], 'https://yandex.ru');
  });

  it('does not touch a profile already at the current version', () => {
    const current = { ...profileFromV6(), formatVersion: PROFILE_FORMAT_VERSION };
    const profile = migrateProfile(current);

    // Still the old names: a version 7 file saying `obs.` means a plugin
    // genuinely called that, and rewriting it would be corruption.
    assert.equal(profile.root.pages[0]!.buttons[0]!.stateFrom, 'obs.scene');
  });
});
