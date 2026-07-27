import { createCanvas } from '@napi-rs/canvas';

import type { ButtonVisual } from '../index.js';

/** Draws a simple microphone glyph so examples need no asset files. */
export function micIcon(color: string): Buffer {
  const canvas = createCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;

  ctx.beginPath();
  ctx.roundRect(24, 8, 16, 28, 8);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(32, 32, 16, Math.PI, 0, true);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(32, 48);
  ctx.lineTo(32, 56);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

/** Mock streamer panel shared by the preview and the on-device demo. */
export function demoPanel(state: { micOn: boolean; counter: number }): Map<number, ButtonVisual> {
  return new Map<number, ButtonVisual>([
    [
      0,
      {
        background: state.micOn ? '#1d7a3c' : '#8a1f1f',
        icon: { source: micIcon('#ffffff') },
        label: { text: state.micOn ? 'Мик: вкл' : 'Мик: выкл', fontSize: 15 },
      },
    ],
    [1, { background: '#264653', label: { text: 'Сцена 1', fontSize: 18 } }],
    [2, { background: '#264653', label: { text: 'Сцена 2', fontSize: 18 } }],
    [3, { background: '#6d3580', label: { text: 'Клип', fontSize: 18 } }],
    [4, { background: '#20242b', label: { text: String(state.counter), fontSize: 42, color: '#ffd166' } }],
    [5, { background: '#0f4c5c', label: { text: 'Музыка', position: 'top', fontSize: 16 } }],
    [14, { background: '#3a3d40', label: { text: 'EasyDeck', fontSize: 14, color: '#9ad1ff' } }],
  ]);
}
