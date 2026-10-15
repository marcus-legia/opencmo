import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { priceOf, specSchema, type AiModel } from './generate';
import { EXPLAINER_SCENE_BYTES, sceneBytes } from './explainer';
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
		price: { unit: 'explainer', credits: 1, voiceKchars: 5 },
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

	it('measures the scene as SQL does (jsonb text has a space after every : and ,)', () => {
		expect(sceneBytes({ a: 1, b: ['x', 'y'] })).toBe('{"a": 1, "b": ["x", "y"]}'.length);
		// Compact JSON under the cap, but SQL's text form over it: refused here, not in SQL.
		const sceneWith = (length: number) => ({ ...spec('16:9', 20).scene, beats: Array.from({ length: 16 }, () => ({ say: 'x'.repeat(length), label: 'y'.repeat(20) })) });
		let length = 240;
		while (JSON.stringify(sceneWith(length)).length > EXPLAINER_SCENE_BYTES) length--;
		const scene = sceneWith(length);
		expect(JSON.stringify(scene).length).toBeLessThanOrEqual(EXPLAINER_SCENE_BYTES);
		expect(sceneBytes(scene)).toBeGreaterThan(EXPLAINER_SCENE_BYTES);
		expect(specSchema(model).safeParse({ ...spec('16:9', 20), scene }).success).toBe(false);
	});

	it('price: credits per started 10 s plus the voice per started 1,000 characters', () => {
		// 20 s = 2 started 10 s blocks, narration < 1,000 characters = 5.
		expect(priceOf(model, spec('16:9', 20) as never)).toBe(7);
		expect(priceOf(model, spec('16:9', 25) as never)).toBe(8);
		// Narration counted in code points: 600 emoji are 600 characters, not 1,200 UTF-16 units.
		const emoji = { ...spec('16:9', 20), scene: { ...spec('16:9', 20).scene, beats: [{ say: '😀'.repeat(240) }, { say: '😀'.repeat(240) }, { say: '😀'.repeat(119) }] } };
		expect(priceOf(model, emoji as never)).toBe(7);
	});
});

describe('sync_explainer', () => {
	const words = [
		{ text: 'A', start: 0.1, end: 0.2 },
		{ text: 'song', start: 0.25, end: 0.6 },
		{ text: 'plays.', start: 0.65, end: 1.0 },
		{ text: 'Your', start: 1.6, end: 1.8 },
		{ text: 'phone', start: 1.85, end: 2.2 },
		{ text: 'knows.', start: 2.25, end: 2.7 },
	];

	function memory() {
		const files = new Map<string, unknown>();
		return {
			files,
			ctx: {
				...ctx,
				saveTranscript: async (transcript: unknown) => {
					const path = `assets/transcripts/${String(files.size).padStart(64, '0')}.json`;
					files.set(path, structuredClone(transcript));
					return path;
				},
			} as unknown as OpContext,
		};
	}

	async function placed() {
		const { document } = await applyOps(busy, [op('16:9', 30)], ctx);
		const layer = sceneNode(document).children!.find((child) => child.kind === 'rect' && child.name !== undefined && String(child.name).startsWith('Explainer'))!;
		return { document, id: layer.id as string };
	}

	const captionsOf = (document: ClipDocument) => {
		const out: Node[] = [];
		const visit = (node: Node) => {
			if (node.kind === 'captions') out.push(node);
			for (const child of node.children ?? []) visit(child);
		};
		visit(sceneNode(document));
		return out;
	};

	it('adds one visible captions layer timed like the explainer, with source = the explainer layer', async () => {
		const { document, id } = await placed();
		const { files, ctx: context } = memory();
		const { document: next, results } = await applyOps(document, [{ op: 'sync_explainer', element_id: id, words }], context);
		expect(() => validate(next)).not.toThrow();
		expect(results).toEqual([{ op: 'sync_explainer', summary: 'Add captions from the explainer', changed: true }]);
		const [layer, ...rest] = captionsOf(next);
		expect(rest).toHaveLength(0);
		expect(layer).toMatchObject({ name: 'Captions · How Shazam hears a song', source: id, start: 4, end: 34 });
		expect(layer!.hidden).toBeUndefined();
		const transcript = files.get(layer!.src as string) as { text: string }[];
		expect(transcript.map((line) => line.text)).toEqual(['A song plays.', 'Your phone knows.']);
	});

	it('a second sync updates the same layer instead of adding another; the same words change nothing', async () => {
		const { document, id } = await placed();
		const { ctx: context } = memory();
		const once = await applyOps(document, [{ op: 'sync_explainer', element_id: id, words }], context);
		const hidden = structuredClone(once.document);
		captionsOf(hidden)[0]!.hidden = true;
		const again = await applyOps(hidden, [{ op: 'sync_explainer', element_id: id, words: words.slice(0, 3) }], context);
		const layers = captionsOf(again.document);
		expect(layers).toHaveLength(1);
		expect(layers[0]!.src).not.toBe(captionsOf(once.document)[0]!.src);
		// The user's choice to hide stays.
		expect(layers[0]!.hidden).toBe(true);
	});

	it('no words (the fake voice) → no change; not an Assistant op; refuses a layer that is not an explainer', async () => {
		const { document, id } = await placed();
		const { document: same, results } = await applyOps(document, [{ op: 'sync_explainer', element_id: id }], ctx);
		expect(same).toBe(document);
		expect(results[0]!.changed).toBe(false);
		expect(AGENT_OP_INPUTS.sync_explainer).toBeUndefined();
		await expect(applyOps(document, [{ op: 'sync_explainer', element_id: 'bg', words }], memory().ctx)).rejects.toThrow('No explainer with id "bg"');
	});
});

describe('explainer scene: theme and personality', () => {
	const model = {
		id: 'motion-explainer',
		kind: 'video',
		provider: 'opencmo-motion',
		name: 'Explainer',
		description: '',
		price: { unit: 'explainer', credits: 1, voiceKchars: 5 },
		limits: { maxPromptChars: 200, scene: true, aspectRatios: ['16:9', '9:16', '1:1'], durations: [15, 20, 25, 30], voices: ['Aria'] },
	} as AiModel;

	it('accepts the contract values and nothing else', () => {
		const withScene = (extra: Record<string, unknown>) => ({ ...spec('16:9', 20), scene: { ...spec('16:9', 20).scene, ...extra } });
		expect(specSchema(model).safeParse(withScene({ theme: 'paper', personality: 'playful' })).success).toBe(true);
		expect(specSchema(model).safeParse(withScene({ theme: 'neon' })).success).toBe(false);
		expect(specSchema(model).safeParse(withScene({ personality: 'calm' })).success).toBe(false);
		// A storyboard's `visual` is for the user and the model, never in the spec.
		expect(specSchema(model).safeParse(withScene({ beats: beats.map((beat) => ({ ...beat, visual: 'a phone' })) })).success).toBe(false);
	});
});
