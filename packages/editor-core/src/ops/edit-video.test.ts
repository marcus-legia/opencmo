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

const edit = { op: 'edit_video', start: 4, end: 8.5, model: 'fake-edit', prompt: 'make it look like night', seed: 5 };

type Node = Record<string, unknown> & { paints?: { src: Record<string, unknown>; objectFit?: string }[] };
const children = (document: ClipDocument) => (document.stage.children[0] as unknown as { children: Node[] }).children;

describe('edit_video', () => {
	it('places the edited range over the speaker in the same box, muted, below captions', async () => {
		const { document } = await applyOps(doc([SPEAKER]), [edit], ctx);
		expect(children(document).map((node) => node.kind)).toEqual(['video', 'rect', 'captions']);
		const layer = children(document)[1]!;
		expect(layer).toMatchObject({ name: 'AI edit', x: 0, y: 0, width: 1080, height: 1920, start: 4, end: 8.5, muted: true });
		expect(layer.paints![0]).toMatchObject({ type: 'video', objectFit: 'cover' });
		// Source second of clip 4 s = sourceIn 10 + 4; whole seconds for the model.
		expect(layer.paints![0]!.src).toEqual({
			generate: 'video',
			model: 'fake-edit',
			prompt: 'make it look like night',
			aspectRatio: '9:16',
			duration: 5,
			sourceVideo: 'assets/master.mp4',
			sourceStart: 14,
			seed: 5,
		});
		// Face tracking follows: 4 s into the speaker, x is already -32.
		expect((layer.tracks as { keyframes: { time: number; value: number }[] }[])[0]!.keyframes.map((key) => [key.time, key.value])).toEqual([
			[0, -32],
			[1, -40],
		]);
		expect(() => validate(document)).not.toThrow();
	});

	it('refuses ranges the model cannot take, a cut, and a moved layout', async () => {
		await expect(applyOps(doc([SPEAKER]), [{ ...edit, end: 5.5 }], ctx)).rejects.toThrow(/3 to 10 seconds/);
		await expect(applyOps(doc([SPEAKER]), [{ ...edit, end: 15 }], ctx)).rejects.toThrow(/3 to 10 seconds/);
		const cut = doc([
			{ ...SPEAKER, id: 'a', end: 6 },
			{ ...SPEAKER, id: 'b', start: 6, sourceIn: 20 },
		]);
		await expect(applyOps(cut, [edit], ctx)).rejects.toThrow(/no cut in it/);
		const moved = doc([{ kind: 'group', id: 'g', name: 'Speaker', x: 100, start: 0, end: 30, children: [{ ...SPEAKER, start: 0 }] }]);
		await expect(applyOps(moved, [edit], ctx)).rejects.toThrow(/layout/);
	});
});
