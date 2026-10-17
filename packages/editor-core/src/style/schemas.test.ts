import { describe, expect, it } from 'vitest';

import { EditPlanSchema } from './plan';
import { StylePresetSchema } from './preset';

/** The examples of docs/style-skills-build.md, verbatim. */
const PRESET = {
	captions: { preset: 'spotlight', maxWords: 2, reveal: 'fade', emphasis: { fontFamily: 'Fraunces', fontStyle: 'italic', color: 'accent' } },
	hookTitle: { accentLine: 2, accentBox: true, accentFontFamily: 'Fraunces', accentFontStyle: 'italic', seconds: 3 },
	speaker: { punchIn: { scales: [1.0, 1.15], minShot: 1.2 } },
	chapters: { transition: 'whip' },
	proof: { zoom: 1.8, mark: 'marker' },
	palette: { accent: 'brand', paper: '#FFFFFF', ink: '#111111' },
};

const PLAN = {
	style: 'senior-dev-listicle',
	hook: { lines: ['3 tools I open every morning', 'and why they beat the paid ones'] },
	emphasis: [{ quote: 'free' }, { quote: '24' }],
	chapters: [{ quote: 'number one is', title: 'Linters' }],
	list: { quote: 'here are five', items: [{ label: 'repo-a', meta: '12.4k' }, { label: 'repo-b', blur: true }], reveal: [{ quote: 'first' }, { quote: 'second' }] },
	proofs: [{ capture_id: 'cap_1', quote: 'it has 24 skills', focus: '24 lifecycle skills' }],
};

describe('style contracts', () => {
	it('the example preset and plan parse', () => {
		expect(StylePresetSchema.parse(PRESET)).toEqual(PRESET);
		expect(EditPlanSchema.parse(PLAN)).toEqual(PLAN);
	});

	it('every key of a preset is optional; the plan defaults its lists', () => {
		expect(StylePresetSchema.parse({})).toEqual({});
		expect(EditPlanSchema.parse({ style: 'x' })).toEqual({ style: 'x', emphasis: [], chapters: [], proofs: [] });
	});

	it('unknown keys fail at every level', () => {
		expect(StylePresetSchema.safeParse({ ...PRESET, music: 'lofi' }).success).toBe(false);
		expect(StylePresetSchema.safeParse({ captions: { preset: 'spotlight', size: 2 } }).success).toBe(false);
		expect(StylePresetSchema.safeParse({ captions: { emphasis: { weight: 700 } } }).success).toBe(false);
		expect(EditPlanSchema.safeParse({ ...PLAN, voice: 'calm' }).success).toBe(false);
		expect(EditPlanSchema.safeParse({ ...PLAN, emphasis: [{ quote: 'free', start: 1 }] }).success).toBe(false);
		expect(EditPlanSchema.safeParse({ ...PLAN, proofs: [{ ...PLAN.proofs[0], url: 'https://x.dev' }] }).success).toBe(false);
	});

	it('limits hold', () => {
		expect(StylePresetSchema.safeParse({ captions: { maxWords: 7 } }).success).toBe(false);
		expect(StylePresetSchema.safeParse({ speaker: { punchIn: { scales: [1, 1.6], minShot: 1 } } }).success).toBe(false);
		expect(StylePresetSchema.safeParse({ palette: { accent: 'red' } }).success).toBe(false);
		expect(StylePresetSchema.safeParse({ chapters: { transition: 'spin' } }).success).toBe(false);
		expect(EditPlanSchema.safeParse({ ...PLAN, hook: { lines: ['a', 'b', 'c'] } }).success).toBe(false);
		expect(EditPlanSchema.safeParse({ ...PLAN, proofs: Array.from({ length: 7 }, () => PLAN.proofs[0]) }).success).toBe(false);
	});
});
