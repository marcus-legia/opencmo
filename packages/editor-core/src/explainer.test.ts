import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { priceOf, specSchema, type AiModel } from './generate';
import { ClipSceneSchema, clipSeconds, EXPLAINER_SCENE_BYTES, ExplainerSceneSchema, sceneBytes } from './explainer';
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

	it('does not count the images against the script cap', () => {
		const assets = Array.from({ length: 6 }, (_, i) => ({ name: `shot-${i}`, ref: `11111111-1111-4111-8111-111111111111/${'x'.repeat(400)}.png` }));
		const scene = { ...spec('16:9', 20).scene, beats: Array.from({ length: 12 }, () => ({ say: 'x'.repeat(240) })) };
		expect(sceneBytes(scene)).toBeLessThanOrEqual(EXPLAINER_SCENE_BYTES);
		expect(sceneBytes({ ...scene, assets })).toBeGreaterThan(EXPLAINER_SCENE_BYTES);
		expect(specSchema(model).safeParse({ ...spec('16:9', 20), scene: { ...scene, assets } }).success).toBe(true);
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

describe('motion clips and image assets (shared contract)', () => {
	const clipScene = (count: number) => ({ template: 'clip', code_ref: CODE_REF, title: 'Logo', beats: Array.from({ length: count }, () => ({ say: 'The mark lands.', seconds: 1 })) });

	it('clipSeconds rounds 3.2 s up to 4 and clamps 40 s to 30', () => {
		expect(clipSeconds([{ say: 'a', seconds: 1.2 }, { say: 'b', seconds: 2 }])).toBe(4);
		expect(clipSeconds([{ say: 'a', seconds: 20 }, { say: 'b', seconds: 20 }])).toBe(30);
		expect(clipSeconds([{ say: 'a', seconds: 1 }])).toBe(3);
		expect(clipSeconds([{ say: 'a', seconds: 0.1 + 0.2 }, { say: 'b', seconds: 2.7 }])).toBe(3);
	});

	it('ClipSceneSchema refuses 9 beats', () => {
		expect(ClipSceneSchema.safeParse(clipScene(8)).success).toBe(true);
		expect(ClipSceneSchema.safeParse(clipScene(9)).success).toBe(false);
		expect(ClipSceneSchema.safeParse({ ...clipScene(1), beats: [{ say: 'No time.' }] }).success).toBe(false);
	});

	it('ExplainerSceneSchema accepts assets with a media path', () => {
		const scene = { template: 'explainer', code_ref: CODE_REF, title: 'How Shazam hears a song', beats };
		const ref = '6a1f3c1e-0000-4000-8000-000000000001/uploads/screen.png';
		expect(ExplainerSceneSchema.safeParse({ ...scene, assets: [{ name: 'screen', ref }] }).success).toBe(true);
		expect(ExplainerSceneSchema.safeParse({ ...scene, assets: [{ name: 'Screen', ref }] }).success).toBe(false);
		expect(ExplainerSceneSchema.safeParse({ ...scene, assets: [{ name: 'a', ref }, { name: 'a', ref }] }).success).toBe(false);
		expect(ExplainerSceneSchema.safeParse({ ...scene, assets: Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, ref })) }).success).toBe(false);
	});
});

describe('motion-clip spec (B1)', () => {
	const clipModel = {
		id: 'motion-clip',
		kind: 'video',
		provider: 'opencmo-motion',
		name: 'Motion clip',
		description: '',
		price: { unit: 'explainer', credits: 1 },
		limits: { maxPromptChars: 80, scene: true, aspectRatios: ['16:9', '9:16', '1:1'], durations: Array.from({ length: 28 }, (_, i) => i + 3) },
	} as AiModel;
	const clipSpec = {
		prompt: 'Motion clip: Logo reveal',
		aspectRatio: '16:9',
		duration: 5,
		scene: { template: 'clip', code_ref: CODE_REF, title: 'Logo reveal', beats: [{ say: 'The mark lands.', seconds: 2 }, { say: 'The name rises.', seconds: 3 }] },
	};

	it('takes a clip scene, no voice, and costs a credit per started 10 s', () => {
		expect(specSchema(clipModel).safeParse(clipSpec).success).toBe(true);
		expect(specSchema(clipModel).safeParse({ ...clipSpec, voice: 'Aria' }).success).toBe(false);
		expect(specSchema(clipModel).safeParse({ ...clipSpec, scene: { ...clipSpec.scene, template: 'explainer' } }).success).toBe(false);
		const long = { ...clipSpec, duration: 30, scene: { ...clipSpec.scene, beats: [{ say: 'a', seconds: 16 }, { say: 'b', seconds: 15 }] } };
		expect(specSchema(clipModel).safeParse(long).error?.issues[0]?.message).toBe('This motion clip is longer than 30 seconds. Shorten its beats.');
		expect(priceOf(clipModel, clipSpec as never)).toBe(1);
		expect(priceOf(clipModel, { ...clipSpec, duration: 25 } as never)).toBe(3);
	});
});

describe('add_explainer with a silent motion clip (B3)', () => {
	const clipOp = {
		op: 'add_explainer',
		title: 'Logo reveal',
		format: '16:9',
		duration: 5,
		spec: {
			prompt: 'Motion clip: Logo reveal',
			aspectRatio: '16:9',
			duration: 5,
			seed: 3,
			scene: { template: 'clip', code_ref: CODE_REF, title: 'Logo reveal', beats: [{ say: 'The mark lands.', seconds: 2 }, { say: 'The name rises.', seconds: 3 }] },
		},
	};

	it('places one video layer of model motion-clip, with no voice and no captions layer', async () => {
		const { document } = await applyOps(blank, [clipOp], ctx);
		expect(() => validate(document)).not.toThrow();
		const scene = sceneNode(document);
		expect(scene).toMatchObject({ width: 1920, height: 1080, workarea: [0, 5] });
		expect(scene.children).toHaveLength(1);
		const layer = scene.children![0]!;
		expect(layer).toMatchObject({ kind: 'rect', name: 'Motion clip: Logo reveal', end: 5 });
		expect(layer.paints![0]!.src).toMatchObject({ generate: 'video', model: 'motion-clip', duration: 5, scene: { template: 'clip' } });
		expect('voice' in layer.paints![0]!.src).toBe(false);
		expect(describeOp(clipOp as never)).toBe('Add the motion clip "Logo reveal" (5s, 16:9)');
		// No narration, so nothing to caption.
		const { document: same } = await applyOps(document, [{ op: 'sync_explainer', element_id: layer.id as string, words: [{ text: 'x', start: 0, end: 1 }] }], ctx).catch(() => ({ document }));
		expect(JSON.stringify(same)).not.toContain('"captions"');
	});

	it('refuses a clip spec with a voice and an explainer scene without one', async () => {
		await expect(applyOps(blank, [{ ...clipOp, spec: { ...clipOp.spec, voice: 'Aria' } }], ctx)).rejects.toThrow();
		await expect(applyOps(blank, [{ ...op('16:9'), spec: { ...spec('16:9', 20), voice: undefined } }], ctx)).rejects.toThrow();
	});
});


describe('add_explainer placed in half the frame over the speaker', () => {
	/** A 9:16 clip of the user's 16:9 talk, as the upload generator makes it. */
	const speaker = validate({
		version: 1,
		stage: {
			children: [
				{
					kind: 'scene',
					id: 'sc',
					width: 1080,
					height: 1920,
					workarea: [0, 30],
					active: true,
					marks: { reframe: { focus: 0.5, track: [[0, 0.7], [30, 0.7]], mode: 'fill' } },
					children: [
						{ kind: 'video', id: 'talk', src: 'assets/master.mp4', x: -1166.67, width: 3413.33, height: 1920, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 30 },
						{ kind: 'captions', id: 'cap', src: 'assets/transcript.json', start: 0, sourceIn: 0, sourceOut: 30 },
					],
				},
			],
		},
	}) as ClipDocument;
	const silentOp = (format: '1:1' | '16:9' | '9:16', place: string, start = 6) => ({
		op: 'add_explainer',
		title: 'How the funnel leaks',
		format,
		duration: 8,
		start,
		place,
		spec: {
			prompt: 'Motion clip: How the funnel leaks',
			aspectRatio: format,
			duration: 8,
			scene: { template: 'clip', code_ref: CODE_REF, title: 'How the funnel leaks', beats: [{ say: 'Visitors pour in.', seconds: 4 }, { say: 'Most drop at signup.', seconds: 4 }] },
		},
	});

	it('top: a square animation fills the upper 1080x1080 and the speaker gets the band below for its time', async () => {
		const { document } = await applyOps(speaker, [silentOp('1:1', 'top')], ctx);
		expect(() => validate(document)).not.toThrow();
		const scene = sceneNode(document) as Node & { marks: { layout: { ranges: { start: number; end: number; mode: string; ratio: number }[] } } };
		expect(scene.marks.layout.ranges).toEqual([expect.objectContaining({ start: 6, end: 14, mode: 'split-bottom', ratio: 0.438 })]);
		const layer = JSON.stringify(document).includes('Motion clip: How the funnel leaks') && scene.children!.find((child) => child.name === 'Motion clip: How the funnel leaks')!;
		expect(layer).toMatchObject({ x: 0, y: 0, width: 1080, height: 1080, start: 6, end: 14 });
		// Over the speaker group and the layout panel, under the captions.
		const names = scene.children!.map((child) => (child.marks as { layout?: string } | undefined)?.layout ?? child.name ?? child.kind);
		expect(names.indexOf('Motion clip: How the funnel leaks')).toBeGreaterThan(names.indexOf('panel'));
		expect(names.at(-1)).toBe('captions');
	});

	it("the clip's own captions move to the seam for the split and back after", async () => {
		const { document } = await applyOps(speaker, [silentOp('1:1', 'top')], ctx);
		const captions = sceneNode(document).children!.find((child) => child.kind === 'captions') as Node & { tracks: { id: string; property: string; keyframes: { time: number; value: number }[] }[] };
		const track = captions.tracks.find((item) => item.property === 'offsetY')!;
		expect(track.id).toMatch(/^layout-caption-offsetY-/);
		// classic sits centred (960); the seam is at 1079.04 (ratio 0.438) and the captions centre 5% above it.
		expect(track.keyframes.map(({ time, value }) => [time, value])).toEqual([[6, 0], [6.3, 23.04], [13.7, 23.04], [14, 0]]);
		const { document: full } = await applyOps(document, [{ op: 'set_layout', mode: 'full', start: 0, end: 30 }], ctx);
		expect((sceneNode(full).children!.find((child) => child.kind === 'captions') as Node).tracks).toBeUndefined();
	});

	it('bottom: the animation below, the speaker on top; a 16:9 animation takes a shorter band', async () => {
		const { document } = await applyOps(speaker, [silentOp('16:9', 'bottom')], ctx);
		const scene = sceneNode(document) as Node & { marks: { layout: { ranges: { mode: string; ratio: number }[] } } };
		expect(scene.marks.layout.ranges[0]).toMatchObject({ mode: 'split-top', ratio: 0.683 });
		expect(scene.children!.find((child) => child.name === 'Motion clip: How the funnel leaks')).toMatchObject({ x: 0, y: 1312, width: 1080, height: 608 });
	});

	it('refuses a shape that cannot share the frame and names the ones that can', async () => {
		await expect(applyOps(speaker, [silentOp('9:16', 'top')], ctx)).rejects.toThrow(/does not fit half of this 1080x1920 frame next to the speaker\. Use format 16:9 or 1:1\./);
	});

	it('without place, a split already there takes the animation into its visual band', async () => {
		const { document: split } = await applyOps(speaker, [{ op: 'set_layout', mode: 'split-bottom', start: 2, end: 20, ratio: 0.5 }], ctx);
		const { document } = await applyOps(split, [silentOp('1:1', undefined as never, 4)], ctx);
		// The 960 px band: the square fits its height, centred across.
		expect(sceneNode(document).children!.find((child) => child.name === 'Motion clip: How the funnel leaks')).toMatchObject({ y: 0, height: 960, width: 960, x: 60 });
	});
});

describe('add_explainer places on a 16:9 talking video', () => {
	const talk = validate({
		version: 1,
		stage: {
			children: [
				{
					kind: 'scene',
					id: 'sc',
					width: 1920,
					height: 1080,
					workarea: [0, 30],
					active: true,
					children: [
						{ kind: 'video', id: 'talk', src: 'assets/master.mp4', x: 0, width: 1920, height: 1080, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 30 },
						{ kind: 'captions', id: 'cap', src: 'assets/transcript.json', start: 0, sourceIn: 0, sourceOut: 30 },
					],
				},
			],
		},
	}) as ClipDocument;
	const placed = (format: '1:1' | '16:9', place: string) => ({
		op: 'add_explainer',
		title: 'Setup steps',
		format,
		duration: 6,
		start: 4,
		place,
		spec: { prompt: 'Motion clip: Setup steps', aspectRatio: format, duration: 6, scene: { template: 'clip', code_ref: CODE_REF, title: 'Setup steps', beats: [{ say: 'Install it.', seconds: 3 }, { say: 'Run it.', seconds: 3 }] } },
	});
	const layerOf = (document: ClipDocument) => sceneNode(document).children!.find((child) => child.name === 'Motion clip: Setup steps')!;
	const roles = (document: ClipDocument) => sceneNode(document).children!.map((child) => (child.marks as { layout?: string } | undefined)?.layout ?? child.name ?? child.kind);

	it('right: the speaker in the left column, the animation fitted to the right one', async () => {
		const { document } = await applyOps(talk, [placed('1:1', 'right')], ctx);
		const ranges = (sceneNode(document).marks as { layout: { ranges: { mode: string; anchor: string }[] } }).layout.ranges;
		expect(ranges[0]).toMatchObject({ mode: 'side-by-side', anchor: 'left' });
		expect(layerOf(document)).toMatchObject({ x: 960, y: 60, width: 960, height: 960 });
	});

	it('keeps the panel colour of the range it replaces', async () => {
		const { document } = await applyOps(talk, [{ op: 'set_layout', mode: 'side-by-side', start: 2, end: 20, background: '#F4F1EA' }, placed('1:1', 'right')], ctx);
		const ranges = (sceneNode(document).marks as { layout: { ranges: { start: number; background?: string }[] } }).layout.ranges;
		expect(ranges.every((range) => range.background === '#F4F1EA')).toBe(true);
	});

	it('without a place, fills the visual column of a side-by-side already there', async () => {
		const { document } = await applyOps(talk, [{ op: 'set_layout', mode: 'side-by-side', anchor: 'left', start: 2, end: 20 }, placed('1:1', undefined as never)], ctx);
		const layer = layerOf(document) as unknown as { x: number; width: number };
		expect(layer.x).toBeGreaterThanOrEqual(960 - 1);
		expect(layer.x + layer.width).toBeLessThanOrEqual(1920);
	});

	it('without a place, holds a layout that ends before the animation does', async () => {
		const { document } = await applyOps(talk, [{ op: 'set_layout', mode: 'pip', start: 2, end: 6 }, placed('16:9', undefined as never)], ctx);
		const ranges = (sceneNode(document).marks as { layout: { ranges: { start: number; end: number }[] } }).layout.ranges;
		expect(ranges).toEqual([expect.objectContaining({ start: 2, end: 10 })]);
	});

	it('refuses columns on a vertical frame and layouts without a speaker', async () => {
		const tall = validate({ version: 1, stage: { children: [{ ...(talk.stage.children[0] as object), width: 1080, height: 1920 }] } }) as ClipDocument;
		await expect(applyOps(tall, [placed('1:1', 'left')], ctx)).rejects.toThrow(/vertical/);
		const noSpeaker = validate({ version: 1, stage: { children: [{ kind: 'scene', id: 'sc', width: 1920, height: 1080, workarea: [0, 30], active: true, children: [{ kind: 'rect', fill: '#123456', start: 0, end: 30 }] }] } }) as ClipDocument;
		await expect(applyOps(noSpeaker, [placed('1:1', 'right')], ctx)).rejects.toThrow(/no speaker video/);
	});

	it('behind: the animation fills the frame under a corner facecam', async () => {
		const { document } = await applyOps(talk, [placed('16:9', 'behind')], ctx);
		const ranges = (sceneNode(document).marks as { layout: { ranges: { mode: string; ratio: number }[] } }).layout.ranges;
		expect(ranges[0]).toMatchObject({ mode: 'pip', ratio: 0.24 });
		expect(layerOf(document)).toMatchObject({ x: 0, y: 0, width: 1920, height: 1080 });
		const order = roles(document);
		expect(order.indexOf('Motion clip: Setup steps')).toBeLessThan(order.indexOf('speaker'));
		expect(order.indexOf('Motion clip: Setup steps')).toBeGreaterThan(order.indexOf('backdrop'));
		// The next rebuild (another layout range here) keeps the backdrop under the animation.
		const { document: again } = await applyOps(document, [{ op: 'set_layout', mode: 'pip', start: 20, end: 26 }], ctx);
		const after = roles(again);
		expect(after.indexOf('Motion clip: Setup steps')).toBeGreaterThan(after.indexOf('backdrop'));
		expect(after.indexOf('Motion clip: Setup steps')).toBeLessThan(after.indexOf('speaker'));
	});
});
