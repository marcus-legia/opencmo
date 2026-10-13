import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';

import { applyFont } from './text.ts';

const cjk = GlobalFonts.families.some((font) => font.family === 'Noto Sans CJK JP');

/** Distinct glyphs draw distinct shapes; a font without the script draws the same box for each. */
function shapes(text: string): number {
  const seen = new Set<string>();
  for (const char of [...text]) {
    const canvas = createCanvas(80, 80);
    const ctx = canvas.getContext('2d');
    applyFont(ctx as never, { style: 'normal', weight: 600, size: 60, family: 'Inter', spacing: 0 } as never, 'top');
    ctx.fillStyle = '#fff';
    ctx.fillText(char, 5, 65);
    const data = ctx.getImageData(0, 0, 80, 80).data;
    let signature = '';
    for (let index = 3; index < data.length; index += 4 * 37) signature += data[index]! > 128 ? '1' : '0';
    seen.add(signature);
  }
  return seen.size;
}

describe('scripts the brand font does not cover', () => {
  it.skipIf(!cjk)('translated captions draw real glyphs in the export, not boxes', () => {
    expect(shapes('こんにちは')).toBe(5);
    expect(shapes('안녕하세요')).toBe(5);
  });
});
