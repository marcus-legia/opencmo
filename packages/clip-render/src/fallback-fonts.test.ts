import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';

import { applyFont, setFallbackFamilies } from './text.ts';

const cjk = GlobalFonts.has('Noto Sans CJK JP');
const emoji = GlobalFonts.has('Noto Color Emoji');
GlobalFonts.registerFromPath(new URL('../../clip-media/fonts/DejaVuSans.ttf', import.meta.url).pathname, 'Fallback Latin Test');

function draw(text: string, family: string): Uint8ClampedArray {
  const canvas = createCanvas(80, 80);
  const ctx = canvas.getContext('2d');
  applyFont(ctx as never, { style: 'normal', weight: 600, size: 60, family, spacing: 0 } as never, 'top');
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 5, 65);
  return ctx.getImageData(0, 0, 80, 80).data;
}

/** Distinct glyphs draw distinct shapes; a font without the script draws the same box for each. */
function shapes(text: string): number {
  const seen = new Set<string>();
  for (const char of [...text]) {
    const data = draw(char, 'Inter');
    let signature = '';
    for (let index = 3; index < data.length; index += 4 * 37) signature += data[index]! > 128 ? '1' : '0';
    seen.add(signature);
  }
  return seen.size;
}

const ink = (data: Uint8ClampedArray) => data.filter((_, index) => index % 4 === 3 && data[index]! > 128).length;

describe('scripts the brand font does not cover', () => {
  afterEach(() => setFallbackFamilies([]));

  it.skipIf(!cjk)('translated captions draw real glyphs in the export, not boxes', () => {
    setFallbackFamilies(['Fallback Latin Test', 'Noto Sans CJK JP']);
    expect(shapes('こんにちは')).toBe(5);
    expect(shapes('안녕하세요')).toBe(5);
  });

  it.skipIf(!emoji)('a missing brand font still draws Latin text with the emoji font in the chain', () => {
    // Skia takes the first family it has: with the emoji font first, Latin text drew nothing.
    setFallbackFamilies(['Fallback Latin Test', 'Noto Color Emoji']);
    expect(ink(draw('Hi', 'Not Installed'))).toBeGreaterThan(50);
  });
});
