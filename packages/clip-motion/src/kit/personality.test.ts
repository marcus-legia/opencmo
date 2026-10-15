import { describe, expect, it } from 'vitest';

import { MOTION, pop, wobble } from './personality.ts';

const sample = (style: (typeof MOTION)[keyof typeof MOTION]) => Array.from({ length: 101 }, (_, i) => pop(i / 100, style));

describe('motion personalities', () => {
	it('lands exactly on 1 and starts at 0', () => {
		for (const style of Object.values(MOTION)) {
			expect(pop(0, style)).toBe(0);
			expect(pop(1, style)).toBe(1);
			expect(style.curve(1)).toBeCloseTo(1, 6);
		}
	});

	it('premium never passes its target; playful and energetic overshoot by about their setting', () => {
		expect(Math.max(...sample(MOTION.premium))).toBeLessThanOrEqual(1);
		for (const name of ['playful', 'energetic'] as const) {
			const peak = Math.max(...sample(MOTION[name])) - 1;
			expect(peak).toBeGreaterThan(MOTION[name].overshoot * 0.6);
			expect(peak).toBeLessThan(MOTION[name].overshoot * 1.6);
		}
	});

	it('winds up the other way first when it has anticipation', () => {
		expect(Math.min(...sample(MOTION.playful))).toBeLessThan(-0.03);
		expect(Math.min(...sample(MOTION.premium))).toBeGreaterThanOrEqual(0);
	});

	it('faster personalities enter faster', () => {
		expect(MOTION.energetic.enter).toBeLessThan(MOTION.corporate.enter);
		expect(MOTION.corporate.enter).toBeLessThan(MOTION.premium.enter);
	});

	it('wobble settles to rest', () => {
		expect(wobble(10, 20)).toBe(0);
		expect(Math.abs(wobble(26, 20))).toBeGreaterThan(0);
		expect(wobble(60, 20)).toBe(0);
	});
});
