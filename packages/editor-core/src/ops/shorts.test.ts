import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { nodes, timelinesOf } from '../doc';
import type { OpContext } from './context';
import { applyOps } from './index';
import { makeShort, makeShortInput, shotBeats, spokenWords } from './shorts';

/** A 16:9 finished edit of a 16:9 master with captions, plus a second timeline the founder is not on. */
const PARENT = {
	version: 1,
	stage: {
		children: [
			{
				kind: 'scene',
				name: 'Main',
				width: 1920,
				height: 1080,
				active: true,
				workarea: [0, 90],
				playhead: 12,
				children: [
					{ kind: 'video', src: 'assets/master.mp4', width: 1920, height: 1080, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 90 },
					{ kind: 'captions', src: 'assets/transcript.json', start: 0, sourceIn: 0, sourceOut: 90 },
				],
			},
			{ kind: 'scene', name: 'Square', x: 2120, width: 1080, height: 1080, workarea: [0, 10], children: [] },
		],
	},
} as unknown as ClipDocument;

const ctx: OpContext = {
	master: { width: 1920, height: 1080 },
	readTranscript: async () => [],
	saveTranscript: async () => 'assets/transcript.json',
};

describe('make_short', () => {
	it('cuts the active timeline into one 9:16 timeline over the range, captions kept', async () => {
		const short = await makeShort.apply(PARENT, { start: 12.5, end: 40 }, ctx);
		const [scene, ...rest] = timelinesOf(short);
		expect(rest).toHaveLength(0);
		expect(scene).toMatchObject({ name: 'Short', active: true, width: 1080, height: 1920, workarea: [12.5, 40] });
		expect(scene).not.toHaveProperty('playhead');
		expect(nodes(short).some((node) => node.kind === 'captions')).toBe(true);
		expect(() => validate(short)).not.toThrow();
	});

	it('leaves the finished edit untouched', async () => {
		const before = structuredClone(PARENT);
		await makeShort.apply(PARENT, { start: 0, end: 30 }, ctx);
		expect(PARENT).toEqual(before);
	});

	it('snaps the range to frames', async () => {
		const short = await makeShort.apply(PARENT, { start: 1.01, end: 20.99 }, ctx);
		expect(timelinesOf(short)[0]!.workarea).toEqual([1, 21]);
	});

	it.each([
		[{ start: 20, end: 20 }, 'end after it starts'],
		[{ start: 30, end: 10 }, 'end after it starts'],
		[{ start: 0, end: 200 }, 'at most 180'],
		[{ start: -1, end: 10 }, ''],
		[{ start: 0, end: Number.NaN }, ''],
	])('refuses %j', (range, message) => {
		const parsed = makeShortInput.safeParse({ op: 'make_short', ...range });
		expect(parsed.success).toBe(false);
		if (message) expect(parsed.error!.issues[0]!.message).toContain(message);
	});
});

describe('spokenWords', () => {
	const transcript = [{ text: 'Hello there. Next one.', words: [['Hello', 3], ['there.', 3.5], ['Next', 10], ['one.', 10.5]].map(([text, start]) => ({ text: text as string, start: start as number, end: (start as number) + 0.4 })) }];
	const document = {
		version: 1,
		stage: {
			children: [
				{
					kind: 'scene',
					width: 1920,
					height: 1080,
					active: true,
					children: [
						{ kind: 'video', src: 'assets/master.mp4', width: 1920, height: 1080, start: 0, sourceIn: 2, sourceOut: 32 },
						{ kind: 'captions', src: 'assets/transcript.json', start: 0, sourceIn: 2, sourceOut: 32 },
						{ kind: 'captions', src: 'assets/voice.json', start: 20, end: 25, marks: { voiceover: { key: 'k' } } },
					],
				},
			],
		},
	} as unknown as ClipDocument;
	const files: Record<string, unknown> = {
		'assets/transcript.json': transcript,
		'assets/voice.json': [{ text: 'Voice.', words: [{ text: 'Voice.', start: 0.5, end: 1 }] }],
	};
	const reading: OpContext = { ...ctx, readTranscript: async (path) => structuredClone(files[path]) as never };

	it('puts the video speech and the voice-over on the timeline, in order', async () => {
		const words = await spokenWords(document, reading);
		expect(words.map((word) => [word.text, word.start])).toEqual([
			['Hello', 1],
			['there.', 1.5],
			['Next', 8],
			['one.', 8.5],
			['Voice.', 20.5],
		]);
	});

	it('finds no beats on an edit without AI shots', () => {
		expect(shotBeats(document, reading)).toEqual([]);
	});
});

describe('shotBeats', () => {
	it('reads an AI video\'s shots as its beats', async () => {
		const blank = { version: 1, stage: { children: [{ kind: 'scene', id: 'sc', width: 1080, height: 1920, fill: '#000000', workarea: [0, 10], active: true, children: [] }] } } as unknown as ClipDocument;
		const shot = (start: number, length: number) => ({ start, length, model: 'fake-video', prompt: `shot at ${start}`, seed: start + 1, duration: 5 });
		const op = { op: 'create_video', aspect: '9:16', seconds: 12, shots: [shot(0, 5), shot(5, 4), shot(9, 3)], voice: { text: 'One. Two.', voice: 'Test A', seed: 9 } };
		const video = { media: { duration: () => null }, readTranscript: async () => [], saveTranscript: async () => 'x' } as unknown as OpContext;
		const { document } = await applyOps(blank, [op as never], video);
		expect(shotBeats(document, video)).toEqual([{ start: 0, end: 5 }, { start: 5, end: 9 }, { start: 9, end: 12 }]);
	});
});
