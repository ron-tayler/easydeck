import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CORE_ON } from './action.js';
import { variablesReadBy } from './profile-variables.js';
import type { ProfileDefinition } from './profile.js';

const profile = (buttons: unknown[]): ProfileDefinition =>
  ({
    id: 'p',
    name: 'p',
    root: { id: 'root', name: 'root', pages: [{ id: 'page', buttons }] },
  }) as unknown as ProfileDefinition;

describe('what a profile reads', () => {
  it('takes the variables a label shows', () => {
    const read = variablesReadBy(
      profile([
        {
          id: 'b',
          key: 0,
          states: [{ id: 'default', visual: { label: { text: '{{obs.scene}} — {{hw.cpu}}%' } } }],
        },
      ]),
    );

    assert.deepEqual(read.sort(), ['hw.cpu', 'obs.scene']);
  });

  /*
   * The same blind spot as the handler one below, in the other direction: a
   * parametric picture reads its variable on every repaint, from the same
   * snapshot a label does. A gauge whose needle is driven by a plugin, on a
   * page where nothing writes the number out, would otherwise never move.
   */
  it('takes what a picture binds a parameter to', () => {
    const read = variablesReadBy(
      profile([
        {
          id: 'b',
          key: 0,
          states: [
            {
              id: 'default',
              visual: {
                icon: {
                  source: 'gauge.svg',
                  params: { angle: { variable: 'obs.volume', from: 0, to: 100 }, width: 4 },
                },
              },
            },
          ],
        },
      ]),
    );

    // The constant beside it is somebody's fixed choice and reads nothing.
    assert.deepEqual(read, ['obs.volume']);
  });

  it('takes the one a button binds its states to', () => {
    const read = variablesReadBy(
      profile([{ id: 'b', key: 0, stateFrom: 'obs.recording', states: [{ id: 'on', visual: {} }] }]),
    );

    assert.deepEqual(read, ['obs.recording']);
  });

  /*
   * The one this file exists for. A handler is the only reader of its variable
   * in a profile where no key displays it, and a plugin that was never told to
   * watch it never sends it — so the handler waiting for recording to start
   * waits forever.
   */
  it('takes what a handler is waiting for, with nothing on screen showing it', () => {
    const read = variablesReadBy(
      profile([
        {
          id: 'b',
          key: 0,
          states: [
            {
              id: 'default',
              visual: {},
              actions: {
                event: [
                  {
                    type: CORE_ON,
                    params: { when: { source: 'variable', name: 'obs.recording', operator: '==', value: true } },
                    branches: { do: [{ type: 'easydeck.go-to-page' }] },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    assert.deepEqual(read, ['obs.recording']);
  });

  it('reads a handler whose condition is a template', () => {
    const read = variablesReadBy(
      profile([
        {
          id: 'b',
          key: 0,
          states: [
            {
              id: 'default',
              visual: {},
              actions: {
                event: [
                  {
                    type: CORE_ON,
                    params: {
                      when: { source: 'template', text: '{{vts.model}}', operator: 'not-empty' },
                    },
                    branches: { do: [] },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    assert.deepEqual(read, ['vts.model']);
  });

  it('leaves the conditions inside a press script alone', () => {
    // Read once, when the key is pressed. Watching it would have a plugin
    // reporting live on something nobody is looking at.
    const read = variablesReadBy(
      profile([
        {
          id: 'b',
          key: 0,
          states: [
            {
              id: 'default',
              visual: {},
              actions: {
                press: [
                  {
                    type: 'core.if',
                    params: { when: { source: 'variable', name: 'obs.recording', operator: '==', value: true } },
                    branches: { then: [] },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    assert.deepEqual(read, []);
  });

  it('watches a handler that a state other than the first one carries', () => {
    // Which state is on screen depends on the variables, so deciding what to
    // watch from that would be circular; every state is looked at instead.
    const read = variablesReadBy(
      profile([
        {
          id: 'b',
          key: 0,
          states: [
            { id: 'first', visual: {} },
            {
              id: 'second',
              visual: {},
              ownActions: true,
              actions: {
                event: [
                  {
                    type: CORE_ON,
                    params: { when: { source: 'variable', name: 'clock.countdown-left', operator: '==', value: 0 } },
                    branches: { do: [] },
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    assert.deepEqual(read, ['clock.countdown-left']);
  });
});
