import { describe, expect, it } from 'vitest';

import { hexToRgb, oklab, oklabToRgb, rgbToOklab } from './color.ts';

describe('oklab', () => {
	it('round-trips sRGB', () => {
		for (const hex of ['#cde993', '#144b41', '#ff7f73', '#000000', '#ffffff']) {
			const back = oklabToRgb(rgbToOklab(hexToRgb(hex)));
			hexToRgb(hex).forEach((c, i) => expect(back[i]).toBeCloseTo(c, 4));
		}
	});
	it('keeps the ends and does not grey out halfway between two saturated colours', () => {
		expect(oklab('#cde993', '#144b41', 0)).toBe('#cde993');
		expect(oklab('#cde993', '#144b41', 1)).toBe('#144b41');
		const chroma = (rgb: [number, number, number]) => Math.hypot(rgbToOklab(rgb)[1], rgbToOklab(rgb)[2]);
		const a = hexToRgb('#2f80ed');
		const b = hexToRgb('#f2994a');
		const rgbMid = a.map((c, i) => (c + b[i]!) / 2) as [number, number, number];
		expect(chroma(hexToRgb(oklab('#2f80ed', '#f2994a', 0.5)))).toBeGreaterThan(chroma(rgbMid));
	});
	it('names a bad colour', () => {
		expect(() => oklab('lime', '#000000', 0.5)).toThrow(/not a #rgb/);
	});
});
