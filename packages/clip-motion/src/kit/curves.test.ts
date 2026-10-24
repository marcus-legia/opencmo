import { describe, expect, it } from 'vitest';

import { curves, drawOn, noise, speedBlur, tween } from './curves.ts';

describe('curves', () => {
	it('every curve starts at 0 and lands on 1', () => {
		for (const [name, curve] of Object.entries(curves)) {
			expect(curve(0), name).toBeCloseTo(0, 5);
			expect(curve(1), name).toBeCloseTo(1, 5);
		}
	});

	it('back overshoots by a few percent and anticipate dips first', () => {
		const peak = Math.max(...Array.from({ length: 101 }, (_, i) => curves.back(i / 100)));
		expect(peak).toBeGreaterThan(1.01);
		expect(peak).toBeLessThan(1.06);
		expect(Math.min(...Array.from({ length: 101 }, (_, i) => curves.anticipate(i / 100)))).toBeLessThan(-0.02);
	});
});

describe('tween', () => {
	it('holds before and after, and eases between', () => {
		expect(tween(0, [10, 20], [100, 200])).toBe(100);
		expect(tween(30, [10, 20], [100, 200])).toBe(200);
		expect(tween(15, [10, 20], [0, 1], 'linear')).toBeCloseTo(0.5);
		expect(tween(15, [10, 20], [[0, 0], [10, 20]], 'linear')).toEqual([5, 10]);
	});

	it('names the curves when one is unknown', () => {
		expect(() => tween(0, [0, 10], [0, 1], 'bouncy' as never)).toThrow(/unknown curve "bouncy": use linear, smooth/);
	});
});

describe('noise', () => {
	it('is deterministic, smooth and within [-1, 1]', () => {
		const a = noise(3);
		const b = noise(3);
		const values = Array.from({ length: 200 }, (_, i) => a(i * 0.05, 1.3));
		expect(values).toEqual(Array.from({ length: 200 }, (_, i) => b(i * 0.05, 1.3)));
		expect(Math.max(...values.map(Math.abs))).toBeLessThanOrEqual(1);
		for (let i = 1; i < values.length; i++) expect(Math.abs(values[i]! - values[i - 1]!)).toBeLessThan(0.2);
		expect(noise(4)(2.5)).not.toBe(a(2.5));
	});
});

describe('drawOn and speedBlur', () => {
	it('draws a stroke from hidden to full', () => {
		expect(drawOn(0)).toEqual({ pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 });
		expect(drawOn(2).strokeDashoffset).toBe(0);
	});

	it('is zero at rest and capped in a fast move', () => {
		expect(speedBlur(0)).toBe(0);
		expect(speedBlur(1)).toBe(0);
		expect(speedBlur(50)).toBe(3);
		expect(speedBlur(1000)).toBe(6);
	});
});
