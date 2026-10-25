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
		expect(region).toEqual({ x: 0.05, y: 0.1, width: 0.6, height: 0.8 });
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
