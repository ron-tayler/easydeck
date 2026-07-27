import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GlobalFonts } from '@napi-rs/canvas';
import { ensureFontsRegistered, resolveFontFamily } from './font-registry.js';

describe('font registry', () => {
  it('registers the bundled fonts so Skia can find them', () => {
    ensureFontsRegistered();
    assert.ok(GlobalFonts.has('EasyDeck Sans'), 'bundled sans should be registered');
  });

  it('maps generic CSS families to bundled fonts (Skia does not know them)', () => {
    assert.match(resolveFontFamily('sans-serif'), /"EasyDeck Sans"/);
    assert.match(resolveFontFamily('monospace'), /"EasyDeck Mono"/);
    assert.match(resolveFontFamily('SERIF'), /"EasyDeck Serif"/);
  });

  it('falls back to the bundled sans when nothing is requested', () => {
    assert.equal(resolveFontFamily(undefined), '"EasyDeck Sans"');
    assert.equal(resolveFontFamily('  '), '"EasyDeck Sans"');
  });

  it('drops font families that are not installed', () => {
    assert.equal(resolveFontFamily('No Such Font 12345'), '"EasyDeck Sans"');
  });

  it('keeps an installed family but appends the bundled fallback', () => {
    const installed = GlobalFonts.families.find((f) => f.family === 'Arial');
    if (!installed) return; // no Arial on this machine
    assert.equal(resolveFontFamily('Arial'), '"Arial", "EasyDeck Sans"');
  });
});
