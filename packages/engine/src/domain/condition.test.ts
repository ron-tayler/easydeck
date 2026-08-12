import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateCondition } from './condition.js';
import type { Condition, ConditionContext } from './condition.js';

const context = (over: Partial<ConditionContext> = {}): ConditionContext => ({
  values: { cpu: 90, scene: 'Intro' },
  buttonState: () => 'on',
  ...over,
});

const holds = (condition: Condition, over: Partial<ConditionContext> = {}): boolean =>
  evaluateCondition(condition, context(over));

describe('asking about a widget setting', () => {
  const asked: { button: string | undefined; name: string }[] = [];

  const widgets = (over: Record<string, string | number | boolean> = {}): Partial<ConditionContext> => ({
    widgetParam: (button, name) => {
      asked.push({ button, name });
      return { reading: 'hw.cpu', period: 60, ...over }[name];
    },
  });

  it('compares what the widget is set to', () => {
    assert.equal(
      holds({ source: 'widget-param', param: 'reading', operator: '==', value: 'hw.cpu' }, widgets()),
      true,
    );
    assert.equal(
      holds({ source: 'widget-param', param: 'reading', operator: '==', value: 'hw.memory' }, widgets()),
      false,
    );
  });

  it('compares numbers as numbers, like everything else here', () => {
    assert.equal(holds({ source: 'widget-param', param: 'period', operator: '>', value: 30 }, widgets()), true);
    assert.equal(holds({ source: 'widget-param', param: 'period', operator: '<', value: 30 }, widgets()), false);
  });

  it('passes the button along, and nothing when the condition names none', () => {
    asked.length = 0;
    holds({ source: 'widget-param', name: 'b7', param: 'reading', operator: '==', value: 'x' }, widgets());
    holds({ source: 'widget-param', param: 'reading', operator: '==', value: 'x' }, widgets());

    assert.deepEqual(asked, [
      { button: 'b7', name: 'reading' },
      // Left to whoever answers, which fills in the key running the script.
      { button: undefined, name: 'reading' },
    ]);
  });

  it('answers nothing where there is no widget, which `empty` can test', () => {
    const none: Partial<ConditionContext> = { widgetParam: () => undefined };

    assert.equal(holds({ source: 'widget-param', param: 'reading', operator: 'empty' }, none), true);
    assert.equal(holds({ source: 'widget-param', param: 'reading', operator: 'not-empty' }, none), false);
  });

  it('answers nothing when no setting was named', () => {
    // A block dropped in and not filled in should sit there quietly.
    assert.equal(holds({ source: 'widget-param', operator: 'not-empty' }, widgets()), false);
  });

  it('answers nothing where nobody can be asked', () => {
    // No `widgetParam` in the context at all: an older host, or a script
    // running somewhere with no deck behind it.
    assert.equal(holds({ source: 'widget-param', param: 'reading', operator: 'not-empty' }), false);
  });
});
