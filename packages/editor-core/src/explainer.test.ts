import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { priceOf, specSchema, type AiModel } from './generate';
import { AGENT_OP_INPUTS, applyOps, describeOp, estimateDuration, explainerSeconds, type OpContext } from './ops';

const ctx = { master: null, media: { duration: () => null }, readTranscript: async () => [], saveTranscript: async () => 'x' } as unknown as OpContext;

const blank = validate({
	version: 1,
	stage: { children: [{ kind: 'scene', id: 'sc', width: 1080, height: 1920, fill: '#000000', workarea: [0, 10], active: true, children: [] }] },
}) as ClipDocument;

const busy = validate({
	version: 1,
	stage: {
		children: [
			{
				kind: 'scene',
				id: 'sc',
				width: 1920,
				height: 1080,
				fill: '#000000',
				workarea: [0, 20],
				playhead: 4,
				active: true,
				children: [
					{ kind: 'rect', id: 'bg', x: 0, y: 0, width: 1920, height: 1080, fill: '#112233' },
					{ kind: 'text', id: 'hook', text: 'Hook', x: 100, y: 100, width: 400, height: 80 },
				],
			},
		],
	},
}) as ClipDocument;

const beats = [
	{ say: 'A song plays in a loud bar and your phone still knows it.', label: 'Noisy bar' },
	{ say: 'It turns the sound into a map of frequencies over time.', label: 'Spectrogram' },
	{ say: 'Only the brightest peaks survive the noise.', label: 'Bright peaks' },
	{ say: 'Pairs of peaks become a fingerprint that matches one song.', label: 'Match' },
];
const CODE_REF = 'a'.repeat(64);

const spec = (format: '16:9' | '9:16' | '1:1', duration: number) => ({
	prompt: 'Explainer: How Shazam hears a song',
	aspectRatio: format,
	duration,
	voice: 'Aria',
	seed: 7,
	scene: { template: 'explainer', code_ref: CODE_REF, title: 'How Shazam hears a song', beats },
});

const op = (format: '16:9' | '9:16' | '1:1', duration = 20, extra: Record<string, unknown> = {}) => ({
	op: 'add_explainer',
	title: 'How Shazam hears a song',
	format,
	duration,
	spec: spec(format, duration),
	...extra,
});

type Node = Record<string, unknown> & { children?: Node[]; paints?: { type: string; src: Record<string, unknown> }[] };
const sceneNode = (document: ClipDocument) => document.stage.children[0] as unknown as Node;

describe('add_explainer', () => {
	it('on a blank clip: sets the frame to the format, fills it from 0 and makes the clip as long as the explainer', async () => {
		const { document } = await applyOps(blank, [op('16:9', 25)], ctx);
		expect(() => validate(document)).not.toThrow();
		const scene = sceneNode(document);
		expect(scene).toMatchObject({ width: 1920, height: 1080, workarea: [0, 25] });
		const layer = scene.children!.at(-1)!;
		expect(layer).toMatchObject({ kind: 'rect', name: 'Explainer: How Shazam hears a song', x: 0, y: 0, width: 1920, height: 1080, end: 25 });
		expect(layer.start ?? 0).toBe(0);
		expect(layer.paints![0]).toMatchObject({
			type: 'video',
			src: { generate: 'video', model: 'motion-explainer', aspectRatio: '16:9', duration: 25, voice: 'Aria', seed: 7, scene: { template: 'explainer', code_ref: CODE_REF } },
		});
	});

	it('on a clip with content: starts at the playhead, sits under text, grows the work area', async () => {
		const { document } = await applyOps(busy, [op('16:9', 30)], ctx);
		const scene = sceneNode(document);
		expect(scene).toMatchObject({ width: 1920, height: 1080, workarea: [0, 34] });
		const names = scene.children!.map((child) => child.name ?? child.id);
		expect(names).toEqual(['bg', 'Explainer: How Shazam hears a song', 'hook']);
		expect(scene.children![1]).toMatchObject({ start: 4, end: 34 });
	});

	it('a format unlike the clip sits as the largest centred box of its own shape', async () => {
		const { document } = await applyOps(busy, [op('9:16', 20, { start: 1 })], ctx);
		const layer = sceneNode(document).children![1]!;
		expect(layer).toMatchObject({ start: 1, end: 21, height: 1080, width: 608, y: 0, x: 656 });
	});

	it('is not a direct Assistant op (it costs credits) and leaves the input document alone', async () => {
		const before = structuredClone(busy);
		await applyOps(busy, [op('16:9')], ctx);
		expect(busy).toEqual(before);
		expect(AGENT_OP_INPUTS.add_explainer).toBeUndefined();
		expect(describeOp(op('16:9') as never)).toBe('Add the explainer "How Shazam hears a song" (20s, 16:9)');
	});

	it('refuses a spec that does not match the explainer it places', async () => {
		await expect(applyOps(blank, [{ ...op('16:9'), format: '9:16' }], ctx)).rejects.toThrow(/same format/);
		await expect(applyOps(blank, [{ ...op('16:9'), duration: 30 }], ctx)).rejects.toThrow(/same duration/);
	});
});

describe('explainer timing and price', () => {
	it('estimates 2.4 words/s plus a 1.5 s tail, rounded up to 5 s, and sells 15–90 s', () => {
		// 44 words → 18.3 + 1.5 = 19.8 → 20.
		expect(estimateDuration(beats)).toBe(20);
		expect(explainerSeconds(beats.slice(0, 1))).toBe(15);
		const long = Array.from({ length: 16 }, () => ({ say: 'word '.repeat(40).trim() }));
		expect(explainerSeconds(long)).toBe(90);
	});

	const model = {
		id: 'motion-explainer',
		kind: 'video',
		provider: 'opencmo-motion',
		name: 'Explainer',
		description: '',
		price: { unit: 'second', credits: 0.1, voiceKchars: 5 },
		limits: { maxPromptChars: 200, scene: true, aspectRatios: ['16:9', '9:16', '1:1'], durations: [15, 20, 25, 30], voices: ['Aria'] },
	} as AiModel;

	it('the spec passes the model schema, with its voice and explainer scene', () => {
		expect(specSchema(model).safeParse(spec('16:9', 20)).success).toBe(true);
		expect(specSchema(model).safeParse({ ...spec('16:9', 20), voice: 'Cloned' }).success).toBe(false);
		const scene = { ...spec('16:9', 20).scene, beats: Array.from({ length: 16 }, () => ({ say: 'x'.repeat(240) })) };
		const tooBig = specSchema(model).safeParse({ ...spec('16:9', 20), scene });
		expect(tooBig.success).toBe(false);
		expect(tooBig.error?.issues[0]?.message).toMatch(/too long/);
	});

	it('price: credits per second plus the voice per started 1,000 characters', () => {
		// 20 s × 0.1 = 2, narration < 1,000 characters = 5.
		expect(priceOf(model, spec('16:9', 20) as never)).toBe(7);
	});
});
