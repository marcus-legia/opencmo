import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { checkDocument } from '../check';
import { nodes } from '../doc';
import { applyOps, type OpContext } from '../ops';
import type { Transcript } from '../transcript';

const SOURCE = {
	version: 1,
	stage: {
		children: [
			{
				kind: 'scene',
				width: 1080,
				height: 1920,
				fill: '#000000',
				active: true,
				workarea: [0, 20],
				children: [
					{ kind: 'video', src: 'assets/master.mp4', width: 1080, height: 1920, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 20 },
					{ kind: 'captions', src: 'assets/transcript.json', start: 0, sourceIn: 0, sourceOut: 20 },
				],
			},
		],
	},
} as unknown as ClipDocument;

const say = (text: string, start: number) => ({ text, words: text.split(' ').map((word, index) => ({ text: word, start: start + index * 0.4, end: start + index * 0.4 + 0.3 })) });
const TRANSCRIPT: Transcript = [say('here are three repos', 1), say('the first one is fast', 3), say('the second one is free', 6), say('and the third one is secret', 9)];

const ctx: OpContext = {
	master: { width: 1080, height: 1920 },
	readTranscript: async () => structuredClone(TRANSCRIPT),
	saveTranscript: async () => 'x',
};

type Entity = Record<string, unknown> & { children?: Entity[] };
const list = (document: ClipDocument) => nodes(document).find((node) => (node as { marks?: { visual?: { op?: string } } }).marks?.visual?.op === 'add_list') as unknown as Entity;
const ITEMS = [{ label: 'fast-repo', meta: '12.4k' }, { label: 'free-repo', meta: '3.1k' }, { label: 'secret-repo', blur: true }];

describe('add_list', () => {
	it('sits in the split panel, rows light up at their quotes, the list stays 2.5 s after the last', async () => {
		const { document } = await applyOps(
			SOURCE,
			[
				{ op: 'set_layout', mode: 'split-bottom', start: 0, end: 15 },
				{ op: 'add_list', items: ITEMS, quote: 'here are three repos', reveal_quotes: ['the first one', 'the second one', 'the third one'] },
			],
			ctx,
		);
		expect(() => validate(document)).not.toThrow();
		const group = list(document);
		expect(group).toMatchObject({ start: 1, end: 11.9 });
		// split-bottom: the speaker below, the visual panel in the upper part of the frame.
		const rows = group.children!.filter((child) => /^Row \d$/.test(String(child.name)));
		expect(rows).toHaveLength(3);
		for (const row of rows) expect(Number(row.y) + Number(row.height)).toBeLessThanOrEqual(1920 / 2 + 1);
		// Row 2's label is dim until "the second one" (6 s, i.e. 5 s into the group), then full.
		const label = group.children!.find((child) => child.name === 'Row 2 label')!;
		const keys = (label.tracks as { keyframes: { time: number; value: number }[] }[])[0]!.keyframes;
		expect(keys[0]).toMatchObject({ time: 0, value: 0.4 });
		expect(keys.at(-1)).toMatchObject({ time: 5.1, value: 1 });
		// The highlight moves on: row 1's highlight goes back out when row 2 comes up.
		const first = group.children!.find((child) => child.name === 'Row 1 highlight')!;
		expect((first.tracks as { keyframes: { value: number }[] }[])[0]!.keyframes.map((key) => key.value)).toEqual([0, 0, 1, 1, 0]);
		// Only the teased label is blurred.
		expect(group.children!.filter((child) => child.effects).map((child) => child.name)).toEqual(['Row 3 label']);
		const errors = checkDocument(document, { duration: () => 20 }).issues.filter((issue) => issue.severity === 'error');
		expect(errors.map((issue) => issue.code)).toEqual([]);
	});

	it('ends with its split panel, and a given start (after a hook) keeps earlier rows lit from the start', async () => {
		const { document } = await applyOps(
			SOURCE,
			[
				{ op: 'set_layout', mode: 'split-bottom', start: 0, end: 7 },
				{ op: 'add_list', items: ITEMS, quote: 'here are three repos', start: 3.5, reveal_quotes: ['the first one', 'the second one', 'the third one'] },
			],
			ctx,
		);
		const group = list(document);
		expect(group).toMatchObject({ start: 3.5, end: 7 });
		// "the first one" (3 s) came before the list: row 1 is lit when the list appears.
		const label = group.children!.find((child) => child.name === 'Row 1 label')!;
		const keys = (label.tracks as { keyframes: { time: number; value: number }[] }[])[0]!.keyframes;
		expect(keys.at(-1)).toMatchObject({ time: 0.1, value: 1 });
		// Rows 1 and 2 both named before the list appears (6.5 s): only row 2, the latest, is highlighted.
		const late = list((await applyOps(SOURCE, [
			{ op: 'set_layout', mode: 'split-bottom', start: 0, end: 15 },
			{ op: 'add_list', items: ITEMS, quote: 'here are three repos', start: 6.5, reveal_quotes: ['the first one', 'the second one', 'the third one'] },
		], ctx)).document);
		const highlights = late.children!.filter((child) => /highlight$/.test(String(child.name))).map((child) => child.name);
		expect(highlights).toEqual(['Row 2 highlight', 'Row 3 highlight']);
		for (const child of [...group.children!, ...late.children!]) {
			for (const track of (child.tracks as { keyframes: { time: number }[] }[] | undefined) ?? []) {
				const times = track.keyframes.map((key) => key.time);
				expect(times).toEqual([...times].sort((a, b) => a - b));
			}
		}
	});

	it('without reveals every row shows at once; reveals out of order or miscounted fail', async () => {
		const { document } = await applyOps(SOURCE, [{ op: 'add_list', items: ITEMS, start: 2, end: 8 }], ctx);
		expect(list(document).children!.some((child) => child.tracks)).toBe(false);
		await expect(applyOps(SOURCE, [{ op: 'add_list', items: ITEMS, start: 2, end: 8, reveal_quotes: ['the second one', 'the first one', 'the third one'] }], ctx)).rejects.toThrow(/order/);
		await expect(applyOps(SOURCE, [{ op: 'add_list', items: ITEMS, start: 2, end: 8, reveal_quotes: ['the first one'] }], ctx)).rejects.toThrow(/one reveal quote per item/);
	});
});
