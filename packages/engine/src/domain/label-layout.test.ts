import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultLabelPosition, layoutLabel } from './label-layout.js';
import type { MeasureText } from './label-layout.js';

/**
 * The rules both surfaces follow.
 *
 * Measuring is faked with a fixed character width, which is exactly what these
 * rules should not depend on: whether a line fits is asked of the measurer, and
 * everything else follows from the answer.
 */

/**
 * A stand-in font: half an em per character, capitals three quarters of the
 * size tall, descenders a fifth below — the shape of a real sans-serif, with
 * none of its exactness, so these tests turn on the rules rather than on
 * anyone's hinting.
 */
const measure: MeasureText = (text, fontSize) => ({
  width: text.length * fontSize * 0.5,
  ascent: text === '' ? 0 : fontSize * 0.75,
  descent: /[gjpqyру]/.test(text) ? fontSize * 0.2 : 0,
  fontAscent: fontSize * 1.1,
});

const KEY = { width: 100, height: 100 };

describe('laying out a key label', () => {
  it('scales the authored size to the key it is drawn on', () => {
    // Sizes are authored against a 100px key. The same profile on a 112px
    // panel and in a window drawing 90px keys must look the same.
    const small = layoutLabel({ text: 'A', fontSize: 20 }, KEY, measure);
    const large = layoutLabel({ text: 'A', fontSize: 20 }, { width: 200, height: 200 }, measure);

    assert.equal(small.fontSize, 20);
    assert.equal(large.fontSize, 40);
  });

  it('uses the size the user set, whatever the text does', () => {
    // A size that adjusts itself is a size nobody can design against: the same
    // profile would read differently on two keys for reasons never chosen.
    const short = layoutLabel({ text: 'Hi', fontSize: 24 }, KEY, measure);
    const long = layoutLabel({ text: 'Совершенно невозможная длина', fontSize: 24 }, KEY, measure);

    assert.equal(short.fontSize, 24);
    assert.equal(long.fontSize, 24);
  });

  it('breaks at spaces', () => {
    const laid = layoutLabel({ text: 'Open browser', fontSize: 20 }, KEY, measure);

    assert.deepEqual(laid.lines, ['Open', 'browser']);
  });

  it('leaves a long word whole, over the edge if need be', () => {
    // Cutting it produced "Инструмент / ы", which is worse than the overflow
    // and harder to notice. Overflow is obvious, and the fix belongs to
    // whoever wrote the label.
    const laid = layoutLabel({ text: 'Автомобилестроение', fontSize: 24 }, KEY, measure);

    assert.deepEqual(laid.lines, ['Автомобилестроение']);
    assert.ok(
      measure(laid.lines[0]!, laid.fontSize).width > KEY.width,
      'this is the overflowing case',
    );
  });

  it('lines the ink up with the edge, not the empty room a font reserves', () => {
    // A font reserves space for accents and descenders that most key labels
    // never use. Measuring by it left "Свет" sitting clear of the edge it was
    // meant to touch, and looking high when centred.
    const top = layoutLabel({ text: 'Hi', fontSize: 20, position: 'top' }, KEY, measure);
    const bottom = layoutLabel({ text: 'Hi', fontSize: 20, position: 'bottom' }, KEY, measure);

    // Capitals are 15 tall at this size, and no descender: the ink starts at
    // the margin and ends at it.
    assert.equal(top.baselines[0], 6 + 15);
    assert.equal(bottom.baselines[0], 100 - 6);
  });

  it('centres the ink in the key', () => {
    const middle = layoutLabel({ text: 'Hi', fontSize: 20, position: 'center' }, KEY, measure);

    // Ink runs from baseline - 15 to the baseline; its middle is the key's.
    assert.equal(middle.baselines[0]! - 15 / 2, 50);
  });

  it('makes room for what hangs below the last line', () => {
    // A descender at the bottom of the key must not be cut off by it.
    const plain = layoutLabel({ text: 'Hi', fontSize: 20, position: 'bottom' }, KEY, measure);
    const hanging = layoutLabel({ text: 'py', fontSize: 20, position: 'bottom' }, KEY, measure);

    assert.equal(hanging.baselines[0], plain.baselines[0]! - 4);
  });

  it('grows the block downwards from the top, upwards from the bottom', () => {
    // Two lines at the bottom must end where one line at the bottom ends.
    const one = layoutLabel({ text: 'Hi', fontSize: 20, position: 'bottom' }, KEY, measure);
    const two = layoutLabel({ text: 'Open browser', fontSize: 20, position: 'bottom' }, KEY, measure);

    assert.equal(one.baselines[0], two.baselines[two.baselines.length - 1]);
  });

  it('defaults to the middle on a plain key and the bottom over a picture', () => {
    // The two surfaces disagreed about exactly this: one centred what the
    // other put at the bottom.
    assert.equal(defaultLabelPosition(false), 'center');
    assert.equal(defaultLabelPosition(true), 'bottom');

    const plain = layoutLabel({ text: 'Hi', fontSize: 20 }, KEY, measure);
    const over = layoutLabel({ text: 'Hi', fontSize: 20 }, KEY, measure, { hasPicture: true });

    assert.ok(over.baselines[0]! > plain.baselines[0]!);
  });

  it('honours line breaks the user typed', () => {
    // The user's own way of deciding where a line ends.
    const laid = layoutLabel({ text: 'Свет\nвкл', fontSize: 18 }, KEY, measure);

    assert.deepEqual(laid.lines, ['Свет', 'вкл']);
  });

  it('answers with one empty line for empty text', () => {
    assert.deepEqual(layoutLabel({ text: '' }, KEY, measure).lines, ['']);
  });
});
