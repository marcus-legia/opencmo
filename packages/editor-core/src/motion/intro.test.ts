import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { DEFAULT_BRAND } from '../brand';
import { checkDocument } from '../check';
import { applyOps, type OpContext } from '../ops';
import { buildIntro, introSpecSchema, PERSONALITY, reviewIntro, type IntroSpec } from './intro';

const ctx = { master: { width: 1080, height: 1920 }, readTranscript: async () => [], saveTranscript: async () => 'x' } as unknown as OpContext;
const blank = {
	version: 1,
	stage: { children: [{ kind: 'scene', id: 'sc', width: 1080, height: 1920, fill: '#000000', workarea: [0, 10], active: true, children: [] }] },
} as unknown as ClipDocument;

const spec: IntroSpec = {
	personality: 'premium',
	emotion: 'confident',
	seconds: 4,
	background: { style: 'gradient' },
	elements: [
		{ key: 'title', kind: 'title', text: 'Book more rooms tonight' },
		{ key: 'line', kind: 'accent_line' },
		{ key: 'tagline', kind: 'tagline', text: 'A 60-second walkthrough' },
	],
	beats: [
		{ target: 'title', at: 0.2, dur: 0.9, motion: 'slide_up' },
		{ target: 'line', at: 0.8, dur: 0.5, motion: 'draw' },
		{ target: 'tagline', at: 1.1, dur: 0.6, motion: 'word_slide' },
	],
};

type Entity = Record<string, unknown> & { children?: Entity[] };
const sceneOf = (document: ClipDocument) => document.stage.children[0] as unknown as Entity;

describe('intro builder', () => {
	it('a reviewed spec has no issues and builds one valid group in one op', async () => {
		expect(introSpecSchema.parse(spec)).toEqual(spec);
		expect(reviewIntro(spec, { hasLogo: false })).toEqual([]);
		const { document } = await applyOps(blank, [{ op: 'add_intro', spec }], ctx);
		expect(() => validate(document)).not.toThrow();
		const group = sceneOf(document).children!.at(-1)!;
		expect(group).toMatchObject({ kind: 'group', name: 'Intro', start: 0, end: 4 });
		expect((group.marks as { visual: { op: string } }).visual.op).toBe('intro');
		expect(group.children!.map((child) => child.name)).toEqual(['Intro background', 'Intro title', 'Intro accent line', 'Intro tagline']);
		const report = checkDocument(document, { duration: () => null });
		expect(report.issues.filter((issue) => issue.severity === 'error' && issue.code !== 'no-visuals' && issue.code !== 'black-gap')).toEqual([]);
	});

	it('adds to a blank edit whose scene has no id yet', async () => {
		const fresh = structuredClone(blank) as unknown as ClipDocument;
		delete (sceneOf(fresh) as Entity).id;
		const { document } = await applyOps(fresh, [{ op: 'add_intro', spec }], ctx);
		expect(sceneOf(document).children!.at(-1)).toMatchObject({ kind: 'group', name: 'Intro' });
	});

	it('uses the personality easing and leaves faster than it enters', () => {
		const node = buildIntro(spec, blank);
		const title = (node.children as Entity[]).find((child) => child.name === 'Intro title')!;
		const tracks = title.tracks as { property: string; keyframes: { time: number; easing?: string }[] }[];
		expect(tracks.map((track) => track.property)).toEqual(['opacity', 'offsetY']);
		expect(tracks[0]!.keyframes[0]).toMatchObject({ time: 0.2, easing: PERSONALITY.premium.easing });
		expect(node.animations).toEqual([{ type: 'fade', phase: 'out', duration: PERSONALITY.premium.exit }]);
		expect(PERSONALITY.premium.exit).toBeLessThan(PERSONALITY.premium.enter);
		const tagline = (node.children as Entity[]).find((child) => child.name === 'Intro tagline')!;
		expect((tagline.animations as { type: string }[])[0]!.type).toBe('wordSlide');
	});

	it('stacks a wrapping title, the accent line and the tagline without overlap', () => {
		const long = { ...spec, elements: spec.elements.map((element) => (element.kind === 'title' ? { ...element, text: 'Book more rooms tonight with one simple trick' } : element)) };
		const children = buildIntro(long, blank).children as { name: string; y: number; height: number }[];
		const [title, line, tagline] = ['Intro title', 'Intro accent line', 'Intro tagline'].map((name) => children.find((child) => child.name === name)!);
		expect(line!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
		expect(tagline!.y).toBeGreaterThanOrEqual(line!.y + line!.height);
	});

	it('takes brand colours and fonts', () => {
		const branded = structuredClone(blank) as unknown as ClipDocument;
		(sceneOf(branded) as Entity).marks = {
			brand: { ...DEFAULT_BRAND, colors: { ...DEFAULT_BRAND.colors, primary: '#112233', accent: '#FF5500', text: '#FAFAFA', background: '#000011' }, fonts: { heading: 'Anton', body: 'Inter' } },
		};
		const node = buildIntro(spec, branded);
		const children = node.children as Entity[];
		expect(children[0]!.paints).toEqual([{ type: 'linearGradient', rotation: 160, stops: [{ offset: 0, color: '#000011' }, { offset: 1, color: '#112233' }] }]);
		expect(children.find((child) => child.name === 'Intro title')).toMatchObject({ fontFamily: 'Anton', color: '#FAFAFA' });
		expect(children.find((child) => child.name === 'Intro accent line')!.paints).toEqual([{ type: 'solid', color: '#FF5500' }]);
	});

	it('review catches unreadable, crowded and broken specs', () => {
		const rushed: IntroSpec = { ...spec, seconds: 2, beats: spec.beats.map((beat) => ({ ...beat, at: 0, dur: 1.5 })) };
		const issues = reviewIntro(rushed, { hasLogo: false }).join('\n');
		expect(issues).toMatch(/after the exit starts/);
		expect(issues).toMatch(/needs 1.2s to be read/);
		const crowded: IntroSpec = {
			...spec,
			elements: [...spec.elements, { key: 'spark', kind: 'lottie', lottie: 'sparkle' }],
			beats: [...spec.beats.map((beat) => ({ ...beat, at: 0.2, dur: 1 })), { target: 'spark', at: 0.2, dur: 1, motion: 'fade' }],
		};
		expect(reviewIntro(crowded, { hasLogo: false }).join('\n')).toMatch(/4 elements move at 0.2s/);
		const broken: IntroSpec = { ...spec, elements: [...spec.elements, { key: 'logo', kind: 'logo' }, { key: 'x', kind: 'lottie', lottie: 'nope' }] };
		const text = reviewIntro(broken, { hasLogo: false }).join('\n');
		expect(text).toMatch(/no brand logo/);
		expect(text).toMatch(/"nope" is not a built-in animation/);
		expect(text).toMatch(/exactly one entrance beat/);
		const late: IntroSpec = { ...spec, beats: [{ ...spec.beats[0]!, at: 1.5 }, ...spec.beats.slice(1).map((beat) => ({ ...beat, at: 0.1 }))] };
		expect(reviewIntro(late, { hasLogo: false }).join('\n')).toMatch(/hero/);
	});

	it('every personality builds a valid document', async () => {
		for (const personality of ['playful', 'premium', 'corporate', 'energetic'] as const) {
			const variant = { ...spec, personality, beats: spec.beats.map((beat) => ({ ...beat, motion: beat.motion === 'slide_up' ? ('pop' as const) : beat.motion })) };
			const { document } = await applyOps(blank, [{ op: 'add_intro', spec: variant }], ctx);
			expect(() => validate(document)).not.toThrow();
		}
	});
});
