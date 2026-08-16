import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GlobalFonts } from '@napi-rs/canvas';
import { ensureFontsRegistered, fontPathOnDisk, resolveFontFamily } from './font-registry.js';

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

describe('finding a font file that Skia has to open itself', () => {
  const inside = String.raw`C:\Program Files\EasyDeck\resources\app.asar\node_modules\dejavu-fonts-ttf\ttf\DejaVuSans.ttf`;
  const beside = String.raw`C:\Program Files\EasyDeck\resources\app.asar.unpacked\node_modules\dejavu-fonts-ttf\ttf\DejaVuSans.ttf`;

  it('leaves an ordinary path alone', () => {
    const path = '/home/someone/easydeck/node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf';
    assert.equal(
      fontPathOnDisk(path, () => {
        throw new Error('should not have looked');
      }),
      path,
    );
  });

  it('reaches past the archive to the copy left on disk', () => {
    // The whole bug: Node reads the first path happily, the operating system
    // has never heard of it, and the panel draws no labels at all.
    assert.equal(
      fontPathOnDisk(inside, (candidate) => candidate === beside),
      beside,
    );
  });

  it('keeps the archive path when nothing was left beside it', () => {
    // Registration then fails, which is what the count in ensureFontsRegistered
    // is there to notice — better a complaint in the log than a silent swap to
    // a path that is equally absent.
    assert.equal(
      fontPathOnDisk(inside, () => false),
      inside,
    );
  });
});
