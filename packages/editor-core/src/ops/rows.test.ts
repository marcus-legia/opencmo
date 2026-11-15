/**
 * Move rules for dropping clips onto another row (plan 2026-11-15 B2, report
 * `docs/research/editor/2026-11-15-capcut-timeline.md` §3): a drop never cuts what is already
 * on the target row. Where the row is taken, the clips get a new row of their own right above it.
 */

import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { applyOps, type OpContext } from '../ops';

type Entity = Record<string, unknown>;

const DURATIONS: Record<string, number> = { 'library/a.mp4': 3, 'library/b.mp4': 3, 'library/c.mp4': 3, 'library/d.mp4': 3 };

const ctx: OpContext = {
	master: { width: 1080, height: 1920 },
	media: { duration: (src: unknown) => (typeof src === 'string' ? (DURATIONS[src] ?? null) : null), transcript: () => null },
} as unknown as OpContext;

const clip = (id: string, src: string, start: number) => ({
	kind: 'rect', id, name: id, x: 0, y: 0, width: 1080, height: 1920, start, end: start + 2,
	paints: [{ type: 'video', src }],
});

/** Scene with a b-roll row (`row1`: a 0–2 s, b 6–8 s) and a lone b-roll clip `c` at `cStart`. */
function scene(cStart: number, extra: Entity[] = []): ClipDocument {
	return {
		version: 1,
		stage: { children: [{
			kind: 'scene', id: 'scene', width: 1080, height: 1920, fill: '#000000', active: true,
			children: [
				{ kind: 'sequence', id: 'row1', name: 'B-roll 1', children: [clip('a', 'library/a.mp4', 0), clip('b', 'library/b.mp4', 6)] },
				clip('c', 'library/c.mp4', cStart),
				...extra,
			],
		}] },
	} as unknown as ClipDocument;
}

const top = (document: ClipDocument) => (document.stage.children[0] as unknown as { children: Entity[] }).children;
const ids = (entity: Entity | undefined) => ((entity?.children as Entity[] | undefined) ?? []).map((child) => child.id);
const span = (entity: Entity | undefined) => entity && { start: entity.start, end: entity.end };

describe('move_to_row: where a dropped clip lands', () => {
	it('into a gap between two clips: joins the row, nothing else changes', async () => {
		const { document } = await applyOps(scene(3), [{ op: 'move_to_row', element_ids: ['c'], target_id: 'row1' }], ctx);
		expect(() => validate(document)).not.toThrow();
		expect(top(document)).toHaveLength(1);
		expect(ids(top(document)[0])).toEqual(['a', 'b', 'c']);
	});

	it('past the end of the row: joins the row', async () => {
		const { document } = await applyOps(scene(10), [{ op: 'move_to_row', element_ids: ['c'], target_id: 'row1' }], ctx);
		expect(ids(top(document)[0])).toEqual(['a', 'b', 'c']);
	});

	it('over a clip: nothing is cut; the clip gets a new row right above the target', async () => {
		const { document } = await applyOps(scene(1), [{ op: 'move_to_row', element_ids: ['c'], target_id: 'row1' }], ctx);
		expect(() => validate(document)).not.toThrow();
		const rows = top(document);
		expect(rows.map((row) => row.kind)).toEqual(['sequence', 'sequence']);
		expect(ids(rows[0])).toEqual(['a', 'b']);
		expect(span((rows[0]!.children as Entity[])[0])).toEqual({ start: 0, end: 2 });
		expect(ids(rows[1])).toEqual(['c']);
		expect(span((rows[1]!.children as Entity[])[0])).toEqual({ start: 1, end: 3 });
	});

	it('over a lone clip: neither clip is cut, and the lone clip is not wrapped for nothing', async () => {
		const doc = scene(10, [clip('d', 'library/d.mp4', 11)]);
		const { document } = await applyOps(doc, [{ op: 'move_to_row', element_ids: ['d'], target_id: 'c' }], ctx);
		const rows = top(document);
		expect(rows.map((row) => row.kind)).toEqual(['sequence', 'rect', 'sequence']);
		expect(span(rows[1])).toEqual({ start: 10, end: 12 });
		expect(ids(rows[2])).toEqual(['d']);
	});

	it('several clips from different rows: all join when the row is free there', async () => {
		const doc = scene(3, [{ kind: 'sequence', id: 'row2', name: 'B-roll 2', children: [clip('d', 'library/d.mp4', 10)] }]);
		const { document } = await applyOps(doc, [{ op: 'move_to_row', element_ids: ['c', 'd'], target_id: 'row1' }], ctx);
		const rows = top(document);
		expect(rows).toHaveLength(1);
		expect(ids(rows[0])).toEqual(['a', 'b', 'c', 'd']);
	});

	it('several clips where one overlaps: they move together to one new row', async () => {
		const doc = scene(3, [{ kind: 'sequence', id: 'row2', name: 'B-roll 2', children: [clip('d', 'library/d.mp4', 7)] }]);
		const { document } = await applyOps(doc, [{ op: 'move_to_row', element_ids: ['c', 'd'], target_id: 'row1' }], ctx);
		const rows = top(document);
		expect(rows).toHaveLength(2);
		expect(ids(rows[0])).toEqual(['a', 'b']);
		expect(ids(rows[1])).toEqual(['c', 'd']);
	});

	it('a drag that also moves in time (move_elements, then move_to_row, as the timeline sends them) checks the new time', async () => {
		const ops = (by: number) => [{ op: 'move_elements', element_ids: ['c'], by }, { op: 'move_to_row', element_ids: ['c'], target_id: 'row1' }];
		let { document } = await applyOps(scene(10), ops(-6.5), ctx);
		expect(ids(top(document)[0])).toEqual(['a', 'b', 'c']);
		({ document } = await applyOps(scene(10), ops(-9), ctx));
		expect(top(document)).toHaveLength(2);
		expect(span((top(document)[1]!.children as Entity[])[0])).toEqual({ start: 1, end: 3 });
	});
});

describe('make_room', () => {
	it('a clip running across the gap stays; clips after it move', async () => {
		const { document } = await applyOps(scene(10), [{ op: 'make_room', at: 1, seconds: 2 }], ctx);
		const row = (top(document)[0]!.children as Entity[]);
		expect(span(row[0])).toEqual({ start: 0, end: 2 });
		expect(span(row[1])).toEqual({ start: 8, end: 10 });
		expect(span(top(document)[1])).toEqual({ start: 12, end: 14 });
	});

	it('a gap after everything changes nothing', async () => {
		const doc = scene(10);
		const { document } = await applyOps(doc, [{ op: 'make_room', at: 20, seconds: 2 }], ctx);
		expect(document).toEqual(doc);
	});
});
