import { describe, expect, it } from 'vitest';

import { AnimateVideoInputSchema, KEYFRAMES_MAX, keyframeCount, keyframeIndexes, LongTakePlanSchema, type LongTakeShot } from './long-take';

const shot = (continues: boolean): LongTakeShot => ({ seconds: 6, words: 'some words', keyframe: 'a desk at dawn', motion: 'slow push-in', continues });
const plan = (...flags: boolean[]) => ({ shots: flags.map(shot) });

describe('keyframeIndexes', () => {
	it('all continuous: each shot ends where the next starts, plus a closing keyframe', () => {
		expect(keyframeIndexes(plan(true, true, true))).toEqual([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 2, end: 3 },
		]);
		expect(keyframeCount(plan(true, true, true))).toBe(4);
	});

	it('all cuts: one keyframe per shot, none ends on a frame', () => {
		expect(keyframeIndexes(plan(false, false, false))).toEqual([
			{ start: 0, end: null },
			{ start: 1, end: null },
			{ start: 2, end: null },
		]);
		expect(keyframeCount(plan(false, false, false))).toBe(3);
	});

	it('mixed: a cut starts the next shot on a fresh keyframe', () => {
		expect(keyframeIndexes(plan(true, false, true, false))).toEqual([
			{ start: 0, end: 1 },
			{ start: 1, end: null },
			{ start: 2, end: 3 },
			{ start: 3, end: null },
		]);
		expect(keyframeCount(plan(true, false, true, false))).toBe(4);
		expect(keyframeCount(plan(false, true))).toBe(3);
	});

	it('every index is a real keyframe, and the most shots fit KEYFRAMES_MAX', () => {
		const long = plan(...Array.from({ length: 18 }, () => true));
		const count = keyframeCount(long);
		expect(count).toBe(KEYFRAMES_MAX);
		for (const { start, end } of keyframeIndexes(long)) {
			expect(start).toBeLessThan(count);
			if (end !== null) expect(end).toBeLessThan(count);
		}
	});
});

describe('LongTakePlanSchema', () => {
	it('accepts a plan and refuses more than 18 shots', () => {
		const base = { title: 'T', script: 'some words', style: 'cinematic', music: 'calm piano' };
		expect(LongTakePlanSchema.safeParse({ ...base, shots: [shot(true)] }).success).toBe(true);
		expect(LongTakePlanSchema.safeParse({ ...base, shots: Array.from({ length: 19 }, () => shot(true)) }).success).toBe(false);
	});
});

describe('keyframes handed to stage 2', () => {
	const full = { title: 'T', script: 'some words', style: 'cinematic' as const, music: 'calm piano', shots: [shot(true), shot(false)] };
	const ref = (index: number) => ({ generation_id: '11111111-2222-4333-8444-555555555555', index });
	const parse = (indexes: number[]) => AnimateVideoInputSchema.safeParse({ plan: full, aspect: '9:16', keyframes: indexes.map(ref) }).success;

	it('accepts exactly the plan keyframes, in any order', () => {
		expect(parse([0, 1])).toBe(true);
		expect(parse([1, 0])).toBe(true);
	});

	it('refuses a gap, a duplicate or an extra keyframe', () => {
		expect(parse([0])).toBe(false);
		expect(parse([0, 0])).toBe(false);
		expect(parse([0, 2])).toBe(false);
		expect(parse([0, 1, 2])).toBe(false);
	});
});
