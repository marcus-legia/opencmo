import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { checkDocument } from '../check';
import { nodes } from '../doc';
import { applyOps, type OpContext } from '../ops';

const ctx = { master: { width: 1920, height: 1080 }, readTranscript: async () => [], saveTranscript: async () => 'x' } as unknown as OpContext;
const base = {
	version: 1,
	stage: { children: [{ kind: 'scene', id: 'sc', width: 1080, height: 1920, fill: '#000000', workarea: [0, 10], active: true, children: [] }] },
} as unknown as ClipDocument;

type Entity = Record<string, unknown> & { children?: Entity[] };
const hookOf = (document: ClipDocument) => nodes(document).find((node) => (node as { marks?: { visual?: { op?: string } } }).marks?.visual?.op === 'add_hook_title') as unknown as Entity;

describe('add_hook_title', () => {
	it('opens the clip (0–3 s) in the upper third, the accent line on a box in its own font', async () => {
		const { document } = await applyOps(
			base,
			[{ op: 'add_hook_title', lines: ['3 tools I open every morning', 'and why they beat the paid ones'], accent_font_family: 'Fraunces', accent_font_style: 'italic', accent_color: '#FF5500' }],
			ctx,
		);
		expect(() => validate(document)).not.toThrow();
		const hook = hookOf(document);
		expect(hook).toMatchObject({ kind: 'group', start: 0, end: 3, name: 'Hook title' });
		const [first, second] = hook.children!;
		expect(first).toMatchObject({ text: '3 tools I open every morning', fontFamily: 'Inter', color: '#FFFFFF' });
		expect(second).toMatchObject({ fontFamily: 'Fraunces', fontStyle: 'italic', color: '#111111', background: { color: '#FF5500' } });
		for (const line of hook.children!) {
			expect(Number(line.y) + Number(line.height)).toBeLessThanOrEqual(1920 / 3 + 1);
			expect(Number(line.y)).toBeGreaterThanOrEqual(1920 * 0.1);
		}
		const errors = checkDocument(document, { duration: () => null }).issues.filter((issue) => issue.severity === 'error' && !['no-visuals', 'black-gap'].includes(issue.code));
		expect(errors).toEqual([]);
	});

	it('one line, no box: the line is in the accent colour; a wrong accent line fails', async () => {
		const { document } = await applyOps(base, [{ op: 'add_hook_title', lines: ['Stop chasing invoices'], accent_box: false, start: 1, end: 4 }], ctx);
		const [line] = hookOf(document).children!;
		expect(line!.background).toBeUndefined();
		expect(line!.color).toBe('#FACC15');
		expect(hookOf(document)).toMatchObject({ start: 1, end: 4 });
		await expect(applyOps(base, [{ op: 'add_hook_title', lines: ['One line'], accent_line: 2 }], ctx)).rejects.toThrow(/accent_line/);
	});
});
