import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { panelRegionAt, readLayout, speakerFocusX } from './layout';
import { applyOps, type OpContext } from './ops';

const ctx = { master: { width: 1920, height: 1080 }, readTranscript: async () => [], saveTranscript: async () => 'x' } as unknown as OpContext;

/** A 16:9 clip of a 16:9 talk, the speaker standing at 75% of the width. */
const landscape = validate({
	version: 1,
	stage: {
		children: [
			{
				kind: 'scene',
				width: 1920,
				height: 1080,
				workarea: [0, 30],
				active: true,
				marks: { reframe: { focus: 0.5, track: [[0, 0.74], [10, 0.75], [20, 0.76]], mode: 'fill' } },
				children: [{ kind: 'video', src: 'assets/master.mp4', x: 0, width: 1920, height: 1080, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 30 }],
			},
		],
	},
}) as ClipDocument;

type Entity = Record<string, unknown> & { children?: Entity[]; tracks?: { property: string; keyframes: { time: number; value: number }[] }[] };
const speakerGroup = (document: ClipDocument) => (document.stage.children[0] as unknown as Entity).children!.find((child) => (child.marks as { layout?: string } | undefined)?.layout === 'speaker')!;
const mask = (document: ClipDocument) => (speakerGroup(document).masks as Entity[])[0]!;
const valueAt = (node: Entity, property: string, time: number) => node.tracks!.find((track) => track.property === property)!.keyframes.find((key) => key.time === time)!.value;

describe('layouts on a landscape frame', () => {
	it('pip is a YouTube facecam: a quarter of the width, the visual on the side away from it', async () => {
		const { document } = await applyOps(landscape, [{ op: 'set_layout', mode: 'pip', anchor: 'bottom-right', start: 2, end: 20 }], ctx);
		expect(readLayout(document)[0]!.ratio).toBe(0.24);
		const region = panelRegionAt(document, 5)!;
		expect(region).toEqual({ x: 0.05, y: 0.08, width: 0.6, height: 0.72 });
		const { document: left } = await applyOps(landscape, [{ op: 'set_layout', mode: 'pip', anchor: 'top-left', start: 2, end: 20 }], ctx);
		expect(panelRegionAt(left, 5)!.x).toBeCloseTo(0.35, 6);
	});

	it('the corner cell and the side column cut around the measured face, not the frame centre', async () => {
		expect(speakerFocusX(landscape)).toBe(0.75);
		const { document } = await applyOps(landscape, [{ op: 'set_layout', mode: 'pip', start: 2, end: 20 }], ctx);
		// The 1080 square around x = 0.75 × 1920 = 1440, clamped inside the frame: 840.
		expect(valueAt(mask(document), 'x', 2.3)).toBe(840);
		const { document: side } = await applyOps(landscape, [{ op: 'set_layout', mode: 'side-by-side', anchor: 'left', start: 2, end: 20 }], ctx);
		// A 960 column around 1440 starts at 960 and moves to the left half.
		expect(valueAt(mask(side), 'x', 2.3)).toBe(960);
		expect(valueAt(speakerGroup(side), 'offsetX', 2.3)).toBe(-960);
	});

	it("the clip's captions go under the visual beside a facecam, and to the foot of the speaker's column", async () => {
		const withCaptions = structuredClone(landscape) as unknown as { stage: { children: { children: unknown[] }[] } };
		withCaptions.stage.children[0]!.children.push({ kind: 'captions', src: 'assets/transcript.json', start: 0, sourceIn: 0, sourceOut: 30 });
		const doc = withCaptions as unknown as ClipDocument;
		const captionsOf = (document: ClipDocument) => (document.stage.children[0] as unknown as Entity).children!.find((child) => child.kind === 'captions')!;
		const { document } = await applyOps(doc, [{ op: 'set_layout', mode: 'pip', anchor: 'bottom-right', start: 2, end: 20 }], ctx);
		// classic is centred (960, 540): the visual side is 0-1305.6 px (cell and two margins away), captions at 0.88 of the height.
		expect(valueAt(captionsOf(document), 'offsetX', 2.3)).toBeCloseTo(652.8 - 960, 3);
		expect(valueAt(captionsOf(document), 'offsetY', 2.3)).toBeCloseTo(950.4 - 540, 3);
		expect(valueAt(captionsOf(document), 'offsetX', 20)).toBe(0);
		const { document: side } = await applyOps(doc, [{ op: 'set_layout', mode: 'side-by-side', anchor: 'right', start: 2, end: 20 }], ctx);
		expect(valueAt(captionsOf(side), 'offsetX', 2.3)).toBe(1440 - 960);
	});

	it('the panel takes the colour asked for, per range, switching while it is hidden', async () => {
		const { document } = await applyOps(
			landscape,
			[
				{ op: 'set_layout', mode: 'side-by-side', start: 2, end: 8, background: '#f4f1ea' },
				{ op: 'set_layout', mode: 'pip', start: 12, end: 18 },
			],
			ctx,
		);
		expect(readLayout(document)[0]!.background).toBe('#F4F1EA');
		const panel = (document.stage.children[0] as unknown as Entity).children!.find((child) => (child.marks as { layout?: string } | undefined)?.layout === 'panel')!;
		const paint = (panel.paints as { color: string; tracks?: { keyframes: { time: number; value: string }[] }[] }[])[0]!;
		expect(paint.color).toBe('#F4F1EA');
		const keys = paint.tracks![0]!.keyframes;
		expect(keys.at(-1)).toMatchObject({ value: '#0F172A' });
		expect(keys.at(-1)!.time).toBeLessThan(12);
		const { document: one } = await applyOps(landscape, [{ op: 'set_layout', mode: 'pip', start: 2, end: 8, background: '#FFFFFF' }], ctx);
		const solid = (one.stage.children[0] as unknown as Entity).children!.find((child) => (child.marks as { layout?: string } | undefined)?.layout === 'backdrop')!;
		expect(solid.paints).toMatchObject([{ type: 'solid', color: '#FFFFFF' }]);
	});

	it('a portrait frame keeps its bigger cell and centred crops (the video pans to the face itself)', async () => {
		const portrait = validate({
			version: 1,
			stage: { children: [{ kind: 'scene', width: 1080, height: 1920, workarea: [0, 30], active: true, marks: { reframe: { focus: 0.5, track: [[0, 0.75]], mode: 'fill' } }, children: [{ kind: 'video', src: 'assets/master.mp4', x: -1500, width: 3413.33, height: 1920, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 30 }] }] },
		}) as ClipDocument;
		expect(speakerFocusX(portrait)).toBe(0.5);
		const { document } = await applyOps(portrait, [{ op: 'set_layout', mode: 'pip', start: 2, end: 20 }], ctx);
		expect(readLayout(document)[0]!.ratio).toBe(0.36);
	});
});
