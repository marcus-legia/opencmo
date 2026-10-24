import { describe, expect, it } from 'vitest';

import { curves, drawOn, noise, poseBlur, retime, shots, speedBlur, tween } from './curves.ts';

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

describe('travel, snap, smear', async () => {
	const { travel, snap, smear } = await import('./curves.ts');
	it('travel starts at the distance, rests at 0 and never overshoots past the cap', () => {
		expect(travel(0, 1400, { overshoot: 24 })).toBeCloseTo(1400);
		expect(travel(1, 1400, { overshoot: 24 })).toBeCloseTo(0);
		const lowest = Math.min(...Array.from({ length: 401 }, (_, i) => travel(i / 400, 1400, { overshoot: 24 })));
		expect(lowest).toBeLessThan(-5);
		expect(lowest).toBeGreaterThanOrEqual(-24);
	});
	it('snap lands on 1 after a small overshoot', () => {
		expect(snap(0)).toBe(0);
		expect(snap(1)).toBe(1);
		expect(snap(0.8, { overshoot: 0.02 })).toBeCloseTo(1.02);
	});
	it('smear is nothing at rest and capped when fast', () => {
		expect(smear(0, 400)).toEqual({ blur: 0, stretch: 1 });
		expect(smear(500, 400).blur).toBe(28);
	});
});

describe('intent curves (after agent-opus)', () => {
	it('impulse starts and ends with zero velocity; leave never brakes', () => {
		const slope = (f: (t: number) => number, t: number) => (f(t + 1e-4) - f(t)) / 1e-4;
		expect(Math.abs(slope(curves.impulse, 0))).toBeLessThan(0.05);
		expect(Math.abs(slope(curves.impulse, 1 - 1e-4))).toBeLessThan(0.05);
		expect(slope(curves.leave, 0.98)).toBeGreaterThan(slope(curves.leave, 0.5));
		expect(curves.arrive(0.3)).toBeGreaterThan(0.6);
	});
});

describe('retime', () => {
	const warp = retime([[0, 0], [30, 45], [60, 60], [90, 90]]);
	it('passes every knot and stays monotone', () => {
		expect(warp.source(30)).toBeCloseTo(45, 6);
		expect(warp.source(60)).toBeCloseTo(60, 6);
		let last = -Infinity;
		for (let f = 0; f <= 90; f += 0.5) {
			const v = warp.source(f);
			expect(v).toBeGreaterThanOrEqual(last);
			last = v;
		}
	});
	it('inverts and continues 1:1 outside the knots', () => {
		for (const f of [3, 17.5, 44, 88]) expect(warp.output(warp.source(f))).toBeCloseTo(f, 5);
		expect(warp.source(100)).toBeCloseTo(100, 6);
	});
	it('refuses knots that do not increase', () => {
		expect(() => retime([[0, 0], [10, 5], [5, 20]])).toThrow(/increase/);
	});
});

describe('shots and poseBlur', () => {
	const at = shots([{ from: 10, to: 20, pose: { scale: 1.5, x: -100 } }, { from: 40, to: 50, pose: { scale: 1 } }]);
	it('holds between moves and lands each pose', () => {
		expect(at(0)).toEqual({ scale: 1, x: 0, y: 0 });
		expect(at(20)).toEqual({ scale: 1.5, x: -100, y: 0 });
		expect(at(30)).toEqual({ scale: 1.5, x: -100, y: 0 });
		expect(at(60)).toEqual({ scale: 1, x: -100, y: 0 });
		expect(at(15).scale).toBeGreaterThan(1);
		expect(at(15).scale).toBeLessThan(1.5);
	});
	it('blurs only while moving, capped', () => {
		expect(poseBlur(at(29), at(30))).toEqual({ x: 0, y: 0 });
		const moving = poseBlur(at(14), at(15));
		expect(moving.x).toBeGreaterThan(0);
		expect(moving.x).toBeLessThanOrEqual(16);
		expect(moving.y).toBeLessThanOrEqual(12);
	});
	it('rejects a bad scale', () => {
		expect(() => shots([{ from: 0, to: 5, pose: { scale: 20 } }])).toThrow(/scale/);
	});
});
