import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { nodes } from '../doc';
import { normalize, type Transcript } from '../transcript';
import { applyOps, type OpContext } from './index';

/** A 9:16 clip of a 16:9 master with face tracking, as the generator makes it. */
const SOURCE = {
	version: 1,
	stage: {
		children: [
			{
				kind: 'scene',
				width: 1080,
				height: 1920,
				active: true,
				workarea: [0, 30],
				marks: { reframe: { focus: 0.5, track: [[2, 0.3], [20, 0.7]], mode: 'fill' } },
				children: [
					{
						kind: 'video',
						src: 'assets/master.mp4',
						x: -484,
						width: 3413.33,
						height: 1920,
						objectFit: 'cover',
						start: 0,
						sourceIn: 2,
						sourceOut: 32,
						tracks: [{ property: 'x', keyframes: [{ time: 2, value: -484, easing: 'easeInOut' }, { time: 20, value: -1849, easing: 'easeInOut' }] }],
					},
					{ kind: 'captions', src: 'assets/transcript.json', start: 0, sourceIn: 2, sourceOut: 32 },
				],
			},
		],
	},
} as unknown as ClipDocument;

// Five takes with "um" between them: cutting the fillers leaves pieces of 1.96, 1.02, 0.52, 1.52 and 20 s.
const TRANSCRIPT: Transcript = [
	{ text: 'first take is here um', words: [['first', 2], ['take', 2.5], ['is', 3], ['here', 3.5], ['um', 4.2]].map(([text, start]) => ({ text: text as string, start: start as number, end: (start as number) + 0.4 })) },
	{ text: 'second take um', words: [['second', 5], ['take', 5.5], ['um', 6.2]].map(([text, start]) => ({ text: text as string, start: start as number, end: (start as number) + 0.4 })) },
	{ text: 'short um', words: [['short', 7], ['um', 7.6]].map(([text, start]) => ({ text: text as string, start: start as number, end: (start as number) + 0.4 })) },
	{ text: 'fourth take now um', words: [['fourth', 9], ['take', 9.5], ['now', 10], ['um', 10.6]].map(([text, start]) => ({ text: text as string, start: start as number, end: (start as number) + 0.4 })) },
	{ text: 'last take here', words: [['last', 12], ['take', 12.5], ['here', 13]].map(([text, start]) => ({ text: text as string, start: start as number, end: (start as number) + 0.4 })) },
];

function memory(): OpContext {
	const files = new Map<string, Transcript>([['assets/transcript.json', TRANSCRIPT]]);
	return {
		master: { width: 1920, height: 1080 },
		readTranscript: async (path) => structuredClone(files.get(path)!),
		saveTranscript: async (transcript) => {
			const path = `assets/transcripts/${String(files.size).padStart(64, '0')}.json`;
			files.set(path, structuredClone(transcript));
			return path;
		},
	};
}

const ums = normalize(TRANSCRIPT).flatMap((segment) => segment.words).filter((word) => word.text === 'um').map((word) => word.id!);
type Piece = Record<string, unknown> & { tracks?: { property: string; keyframes: { time: number; value: number }[] }[] };
const pieces = (document: ClipDocument) => (nodes(document).find((node) => node.kind === 'sequence') as unknown as { children: Piece[] }).children.filter((child) => child.kind === 'video');

async function cutClip(ctx: OpContext) {
	return (await applyOps(SOURCE, [{ op: 'remove_words', word_ids: ums, tightness: 'tight' }], ctx)).document;
}

describe('punch_in', () => {
	it('alternates the two zooms at every cut; a short shot keeps the zoom before it', async () => {
		const ctx = memory();
		const { document } = await applyOps(await cutClip(ctx), [{ op: 'punch_in', scales: [1, 1.15], min_shot: 0.9 }], ctx);
		expect(() => validate(document)).not.toThrow();
		expect(pieces(document).map((piece) => piece.scale ?? 1)).toEqual([1, 1.15, 1.15, 1, 1.15]);
	});

	it('the face stays where it was, and the zoomed picture still covers the frame', async () => {
		const ctx = memory();
		const { document } = await applyOps(await cutClip(ctx), [{ op: 'punch_in', scales: [1, 1.3] }], ctx);
		for (const piece of pieces(document)) {
			const zoom = Number(piece.scale ?? 1);
			const width = Number(piece.width);
			const mid = (Number(piece.sourceIn) + Number(piece.sourceOut)) / 2;
			const focus = 0.3 + (0.4 * (mid - 2)) / 18;
			// Face position in the frame before and after, at the piece's middle (x from the face track).
			const keys = piece.tracks!.find((track) => track.property === 'x')!.keyframes;
			const x = keys.length === 1 ? keys[0]!.value : keys[0]!.value + ((keys.at(-1)!.value - keys[0]!.value) * (mid - keys[0]!.time)) / (keys.at(-1)!.time - keys[0]!.time);
			const centre = x + width / 2;
			const before = x + focus * width;
			const after = centre + zoom * (before - centre) + Number(piece.offsetX ?? 0);
			expect(Math.abs(after - before)).toBeLessThan(1);
			// Left and right edges of the zoomed box still outside the 1080 px frame.
			const left = centre - (zoom * width) / 2 + Number(piece.offsetX ?? 0);
			expect(left).toBeLessThanOrEqual(Math.min(0, x) + 0.5);
			expect(left + zoom * width).toBeGreaterThanOrEqual(Math.max(1080, x + width) - 0.5);
		}
	});

	it('a rerun replaces the punch-in; [1, 1] removes it', async () => {
		const ctx = memory();
		const once = await applyOps(await cutClip(ctx), [{ op: 'punch_in', scales: [1.1, 1.2] }], ctx);
		const twice = await applyOps(once.document, [{ op: 'punch_in', scales: [1.1, 1.2] }], ctx);
		expect(twice.results[0]!.changed).toBe(false);
		const off = await applyOps(twice.document, [{ op: 'punch_in', scales: [1, 1] }], ctx);
		expect(pieces(off.document).every((piece) => piece.scale === undefined && piece.offsetX === undefined)).toBe(true);
	});

	it('a clip without cuts says so', async () => {
		await expect(applyOps(SOURCE, [{ op: 'punch_in' }], memory())).rejects.toThrow(/no cuts to punch in/);
	});
});
