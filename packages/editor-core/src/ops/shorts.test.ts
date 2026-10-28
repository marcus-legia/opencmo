import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { nodes, timelinesOf } from '../doc';
import type { OpContext } from './context';
import { makeShort, makeShortInput } from './shorts';

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
