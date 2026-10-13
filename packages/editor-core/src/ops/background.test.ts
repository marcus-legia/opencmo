import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { applyOps, type OpContext } from './index';

const ctx = {
	master: { width: 1080, height: 1920 },
	media: { duration: () => 60 },
	readTranscript: async () => [],
	saveTranscript: async () => 'x',
} as unknown as OpContext;

const doc = (speaker: Record<string, unknown>[]) =>
	validate({
		version: 1,
		stage: {
			children: [
				{
					kind: 'scene',
					id: 'sc',
					width: 1080,
					height: 1920,
					fill: '#000000',
					workarea: [0, 30],
					active: true,
					children: [...speaker, { kind: 'captions', id: 'cap', src: 'assets/transcript.json', start: 0 }],
				},
			],
		},
	}) as ClipDocument;

const SPEAKER = {
	kind: 'video',
	id: 'm1',
	src: 'assets/master.mp4',
	x: 0,
	y: 0,
	width: 1080,
	height: 1920,
	objectFit: 'cover',
	sourceIn: 10,
	start: 0,
	end: 30,
	tracks: [{ property: 'x', keyframes: [{ time: 0, value: 0 }, { time: 5, value: -40 }] }],
};

const swap = {
	op: 'replace_background',
	start: 4,
	end: 9.5,
	cutout: { model: 'fake-cutout', seed: 3 },
	background: { kind: 'image', model: 'fake-image', prompt: 'a sunny office', seed: 7 },
};

type Node = Record<string, unknown> & { children?: Node[]; paints?: { src: Record<string, unknown>; alpha?: string }[] };
const children = (document: ClipDocument) => (document.stage.children[0] as unknown as Node).children!;

describe('replace_background', () => {
	it('puts a new background and the stacked-alpha cut-out right above the speaker, below captions', async () => {
		const { document } = await applyOps(doc([SPEAKER]), [swap], ctx);
		expect(children(document).map((node) => node.kind)).toEqual(['video', 'group', 'captions']);
		const group = children(document)[1]!;
		expect(group).toMatchObject({ name: 'Background swap', start: 4, end: 9.5 });
		const [background, cutout] = group.children!;
		expect(background).toMatchObject({ name: 'New background', width: 1080, height: 1920, end: 5.5 });
		expect(background!.paints![0]!.src).toMatchObject({ generate: 'image', prompt: 'a sunny office', aspectRatio: '9:16', seed: 7 });
		expect(cutout).toMatchObject({ name: 'Speaker cut-out', width: 1080, height: 1920, muted: true, end: 5.5 });
		expect(cutout!.paints![0]).toMatchObject({ alpha: 'stacked', objectFit: 'cover' });
		// Source second of clip 4 s = sourceIn 10 + 4; whole seconds for the model.
		expect(cutout!.paints![0]!.src).toMatchObject({ generate: 'video', model: 'fake-cutout', sourceVideo: 'assets/master.mp4', sourceStart: 14, duration: 6, seed: 3 });
		// Face tracking follows: the range starts 4 s into the speaker, so x is already -32 there.
		expect((cutout!.tracks as { keyframes: { time: number; value: number }[] }[])[0]!.keyframes.map((key) => [key.time, key.value])).toEqual([
			[0, -32],
			[1, -40],
		]);
		expect(() => validate(document)).not.toThrow();
	});

	it('refuses a range that crosses a cut, a range that is too long, and a moved layout', async () => {
		const cut = doc([
			{ ...SPEAKER, id: 'a', end: 6 },
			{ ...SPEAKER, id: 'b', start: 6, sourceIn: 20 },
		]);
		await expect(applyOps(cut, [swap], ctx)).rejects.toThrow(/no cut in it/);
		await expect(applyOps(doc([SPEAKER]), [{ ...swap, start: 0, end: 16 }], ctx)).rejects.toThrow(/up to 15 seconds/);
		const moved = doc([{ kind: 'group', id: 'g', name: 'Speaker', x: 100, start: 0, end: 30, children: [{ ...SPEAKER, start: 0 }] }]);
		await expect(applyOps(moved, [swap], ctx)).rejects.toThrow(/layout/);
		// apply_layout moves the Speaker group with keyframes, not static props.
		const animated = doc([
			{
				kind: 'group',
				id: 'g',
				name: 'Speaker',
				start: 0,
				end: 30,
				tracks: [{ property: 'offsetY', keyframes: [{ time: 0, value: 0 }, { time: 1, value: -400 }] }],
				children: [{ ...SPEAKER, start: 0 }],
			},
		]);
		await expect(applyOps(animated, [swap], ctx)).rejects.toThrow(/layout/);
	});

	it.each(['split-bottom', 'pip', 'side-by-side'])('swaps the full-frame part of a clip whose %s layout starts later', async (mode) => {
		// The Speaker group apply_layout writes rests (offset 0, scale 1) until the layout starts.
		const { document } = await applyOps(doc([SPEAKER]), [{ op: 'set_layout', mode, start: 12, end: 30 } as never], ctx);
		await expect(applyOps(document, [swap], ctx)).resolves.toBeTruthy();
		// A range that reaches into the layout is still refused, and so is one fully inside it.
		await expect(applyOps(document, [{ ...swap, start: 9, end: 13 }], ctx)).rejects.toThrow(/layout/);
		await expect(applyOps(document, [{ ...swap, start: 14, end: 20 }], ctx)).rejects.toThrow(/layout/);
	});

	it('gives the cut-out its own ids for the face-tracking track it copies', async () => {
		// Engine documents carry ids on tracks and keyframes; a copy that keeps them is invalid.
		const tracked = { ...SPEAKER, tracks: [{ id: 'trk1', property: 'x', keyframes: [{ id: 'k1', time: 0, value: 0 }, { id: 'k2', time: 5, value: -40 }] }] };
		const { document } = await applyOps(doc([tracked]), [{ ...swap, start: 0, end: 5 }], ctx);
		expect(() => validate(document)).not.toThrow();
		const cutout = children(document)[1]!.children![1]! as Node & { tracks: { id?: string; keyframes: { id?: string }[] }[] };
		expect(cutout.tracks[0]!.id).not.toBe('trk1');
		expect(cutout.tracks[0]!.keyframes.map((key) => key.id)).not.toContain('k1');
	});

	it('takes a library file as the background', async () => {
		const { document } = await applyOps(doc([SPEAKER]), [{ ...swap, background: { path: 'assets/office.mp4' } }], ctx);
		const background = children(document)[1]!.children![0]!;
		expect(background).toMatchObject({ muted: true, paints: [{ type: 'video', src: 'assets/office.mp4' }] });
	});
});
