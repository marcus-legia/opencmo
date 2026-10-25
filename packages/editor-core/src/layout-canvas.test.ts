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

	it('a visual on a light panel draws its text dark', async () => {
		const { document } = await applyOps(
			landscape,
			[
				{ op: 'set_layout', mode: 'side-by-side', start: 2, end: 18, background: '#E8E2D6' },
				{ op: 'add_chart', type: 'bar', title: 'Signups', data: [{ label: 'Jan', value: 1 }, { label: 'Feb', value: 2 }], start: 3, end: 10 },
			],
			ctx,
		);
		const json = JSON.stringify(document);
		expect(json).toContain('#15181E');
		const { document: dark } = await applyOps(landscape, [{ op: 'set_layout', mode: 'side-by-side', start: 2, end: 18 }, { op: 'add_chart', type: 'bar', title: 'Signups', data: [{ label: 'Jan', value: 1 }], start: 3, end: 10 }], ctx);
		expect(JSON.stringify(dark)).not.toContain('#15181E');
	});

	it('a list on a light panel gets light rows under its dark text', async () => {
		const { document } = await applyOps(
			landscape,
			[
				{ op: 'set_layout', mode: 'side-by-side', start: 2, end: 18, background: '#F4F1EA' },
				{ op: 'add_list', items: [{ label: 'Install it' }, { label: 'Run it' }], start: 3, end: 10 },
			],
			ctx,
		);
		const list = (document.stage.children[0] as unknown as Entity).children!.find((child) => String(child.name ?? '').startsWith('List'))!;
		const json = JSON.stringify(list);
		expect(json).toContain('#15181E');
		expect(json).not.toContain('#0F172A');
	});

	it('over a light panel the captions turn dark for the range and back after', async () => {
		const portrait = validate({
			version: 1,
			stage: { children: [{ kind: 'scene', width: 1080, height: 1920, workarea: [0, 30], active: true, children: [{ kind: 'video', src: 'assets/master.mp4', x: -1166.67, width: 3413.33, height: 1920, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 30 }, { kind: 'captions', src: 'assets/transcript.json', start: 0, sourceIn: 0, sourceOut: 30 }] }] },
		}) as ClipDocument;
		const { document } = await applyOps(portrait, [{ op: 'set_layout', mode: 'split-bottom', start: 2, end: 10, background: '#E8E2D6' }], ctx);
		const captions = (document.stage.children[0] as unknown as Entity).children!.find((child) => child.kind === 'captions')!;
		const ink = captions.tracks!.find((track) => track.property === 'color')!.keyframes.map(({ time, value }) => [time, value]);
		expect(ink).toEqual([[2, '#FFFFFF'], [2.3, '#15181E'], [9.7, '#15181E'], [10, '#FFFFFF']]);
		const { document: dark } = await applyOps(portrait, [{ op: 'set_layout', mode: 'split-bottom', start: 2, end: 10 }], ctx);
		expect((dark.stage.children[0] as unknown as Entity).children!.find((child) => child.kind === 'captions')!.tracks!.some((track) => track.property === 'color')).toBe(false);
	});

	it('a duplicated timeline keeps moving its captions with its own layouts', async () => {
		const portrait = validate({
			version: 1,
			stage: { children: [{ kind: 'scene', id: 'main', width: 1080, height: 1920, workarea: [0, 30], active: true, children: [{ kind: 'video', id: 'master', src: 'assets/master.mp4', x: -1166.67, width: 3413.33, height: 1920, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 30 }, { kind: 'captions', id: 'subs', src: 'assets/transcript.json', start: 0, sourceIn: 0, sourceOut: 30 }] }] },
		}) as ClipDocument;
		const split = await applyOps(portrait, [{ op: 'set_layout', mode: 'split-bottom', start: 2, end: 10 }], ctx);
		const { document } = await applyOps(split.document, [{ op: 'create_timeline', from: 'main' }, { op: 'set_layout', mode: 'split-bottom', start: 2, end: 10, ratio: 0.6 }], ctx);
		const copy = document.stage.children.find((scene) => (scene as unknown as Entity).active) as unknown as Entity;
		const captions = copy.children!.find((child) => child.kind === 'captions')!;
		const offsets = captions.tracks!.filter((track) => track.property === 'offsetY');
		// One track, ours, rebuilt for the new ratio: not a stale copy taken for a hand-made one.
		expect(offsets).toHaveLength(1);
		expect((offsets[0] as { id?: string }).id).toBe(`layout-caption-offsetY-${captions.id as string}`);
		const original = (document.stage.children[0] as unknown as Entity).children!.find((child) => child.kind === 'captions')!.tracks!.find((track) => track.property === 'offsetY')!;
		expect(offsets[0]!.keyframes[1]!.value).not.toBe(original.keyframes[1]!.value);
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

describe('captions follow the layout', () => {
	const talk = (captions: Record<string, unknown> = {}) =>
		validate({
			version: 1,
			stage: { children: [{ kind: 'scene', width: 1080, height: 1920, workarea: [0, 30], active: true, children: [{ kind: 'video', src: 'assets/master.mp4', x: -1166.67, width: 3413.33, height: 1920, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 30 }, { kind: 'captions', src: 'assets/transcript.json', start: 0, sourceIn: 0, sourceOut: 30, ...captions }] }] },
		}) as ClipDocument;
	const captionsOf = (document: ClipDocument) => (document.stage.children[0] as unknown as Entity).children!.find((child) => child.kind === 'captions')!;
	const keysOf = (document: ClipDocument, property: string) => captionsOf(document).tracks?.find((track) => track.property === property)?.keyframes.map(({ time, value }) => [time, value]);

	it('keep their ink over the speaker, and turn dark over a full light panel', async () => {
		const { document: top } = await applyOps(talk(), [{ op: 'set_layout', mode: 'split-top', start: 2, end: 10, background: '#F4F1EA' }], ctx);
		expect(keysOf(top, 'color')).toBeUndefined();
		const { document: full } = await applyOps(talk(), [{ op: 'set_layout', mode: 'visual-only', start: 2, end: 10, background: '#FFFFFF' }], ctx);
		expect(keysOf(full, 'color')).toEqual([[2, '#FFFFFF'], [2.3, '#15181E'], [9.7, '#15181E'], [10, '#FFFFFF']]);
	});

	it('move on their own clock when the master is sped up', async () => {
		const { document } = await applyOps(talk({ playbackRate: 2, sourceOut: 60 }), [{ op: 'set_layout', mode: 'split-bottom', start: 4, end: 10 }], ctx);
		expect(keysOf(document, 'offsetY')!.map(([time]) => time)).toEqual([8, 8.6, 19.4, 20]);
	});

	it('go straight from one layout to the next that touches it', async () => {
		const { document } = await applyOps(
			talk(),
			[
				{ op: 'set_layout', mode: 'split-bottom', start: 2, end: 6 },
				{ op: 'set_layout', mode: 'pip', start: 6, end: 12 },
			],
			ctx,
		);
		const keys = keysOf(document, 'offsetY')!;
		const inner = keys.filter(([time]) => (time as number) > 2 && (time as number) < 12);
		expect(inner.some(([, value]) => value === 0)).toBe(false);
	});

	it('take a new caption colour across the light range too', async () => {
		const { document } = await applyOps(talk(), [{ op: 'set_layout', mode: 'split-bottom', start: 2, end: 10, background: '#F4F1EA' }], ctx);
		const { document: yellow } = await applyOps(document, [{ op: 'set_caption_style', preset: 'classic', color: '#FFD400' }], ctx);
		expect(keysOf(yellow, 'color')).toEqual([[2, '#FFD400'], [2.3, '#15181E'], [9.7, '#15181E'], [10, '#FFD400']]);
	});
});

describe('a colour change inside a layout', () => {
	const portrait = validate({
		version: 1,
		stage: { children: [{ kind: 'scene', width: 1080, height: 1920, workarea: [0, 30], active: true, children: [{ kind: 'video', src: 'assets/master.mp4', x: -1166.67, width: 3413.33, height: 1920, objectFit: 'cover', start: 0, sourceIn: 0, sourceOut: 30 }] }] },
	}) as ClipDocument;
	const panelOf = (document: ClipDocument) => (document.stage.children[0] as unknown as Entity).children!.find((child) => (child.marks as { layout?: string } | undefined)?.layout === 'panel')!;

	it('keeps the panel open across the seams and switches its colour there', async () => {
		const { document } = await applyOps(
			portrait,
			[
				{ op: 'set_layout', mode: 'split-bottom', start: 2, end: 15 },
				{ op: 'set_layout', mode: 'split-bottom', start: 5, end: 8, background: '#F4F1EA' },
			],
			ctx,
		);
		expect(readLayout(document)).toHaveLength(3);
		const height = panelOf(document).tracks!.find((track) => track.property === 'height')!.keyframes;
		const open = height.find((key) => key.time > 2.5)!.value;
		expect(height.filter((key) => key.time > 2.5 && key.time < 14.5).every((key) => key.value === open)).toBe(true);
		const colour = ((panelOf(document).paints as { tracks: { keyframes: { time: number; value: string }[] }[] }[])[0]!.tracks[0]!.keyframes);
		// Dark until the seam at 5 s, light until 8 s: never light while range A is still on screen.
		expect(colour.filter((key) => key.time < 5).every((key) => key.value === '#0F172A')).toBe(true);
		expect(colour.find((key) => key.time > 5 && key.time < 8)!.value).toBe('#F4F1EA');
	});
});
