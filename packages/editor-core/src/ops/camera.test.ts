import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { nodes } from '../doc';
import { normalize, type Transcript } from '../transcript';
import { flashOpacity, moveDelta } from './camera';
import { applyOps, type OpContext } from './index';

/** A 9:16 clip of a 16:9 master with face tracking: the box is the frame's height exactly, so any move up or down needs a zoom. */
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

const word = (text: string, start: number) => ({ text, start, end: start + 0.4 });
const TRANSCRIPT: Transcript = [
	{ text: 'we hit ten thousand users um', words: [word('we', 2), word('hit', 2.5), word('ten', 3), word('thousand', 3.5), word('users', 4), word('um', 4.6)] },
	{ text: 'and it took one week', words: [word('and', 6), word('it', 6.5), word('took', 7), word('one', 7.5), word('week', 8)] },
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

type Frame = { time: number; value: number };
type Track = { id?: string; property: string; keyframes: Frame[] };
type Video = Record<string, unknown> & { tracks?: Track[] };
const videos = (document: ClipDocument) => nodes(document).filter((node) => node.kind === 'video') as unknown as Video[];
const track = (video: Video, property: string) => video.tracks?.find((item) => item.property === property && String(item.id).startsWith('camera-'));
const at = (frames: Frame[], time: number) => frames.find((frame) => Math.abs(frame.time - time) < 1e-6)?.value;

/** The clip-render transform: does the box, scaled and turned about its centre, still cover the 1080×1920 frame? */
function covered(video: Video, source: number): boolean {
	const value = (property: string, fallback: number) => {
		const frames = video.tracks?.find((item) => item.property === property)?.keyframes ?? [];
		return at(frames, source) ?? (frames.length ? linear(frames, source) : fallback);
	};
	const width = Number(video.width);
	const height = Number(video.height);
	const scale = value('scale', 1);
	const cx = value('x', Number(video.x ?? 0)) + value('offsetX', 0) + width / 2;
	const cy = value('y', 0) + value('offsetY', 0) + height / 2;
	const radians = (value('rotation', 0) * Math.PI) / 180;
	return [[0, 0], [1080, 0], [0, 1920], [1080, 1920]].every(([px, py]) => {
		const u = Math.cos(radians) * (px! - cx) + Math.sin(radians) * (py! - cy);
		const v = -Math.sin(radians) * (px! - cx) + Math.cos(radians) * (py! - cy);
		return Math.abs(u) <= (scale * width) / 2 + 0.5 && Math.abs(v) <= (scale * height) / 2 + 0.5;
	});
}
function linear(frames: Frame[], time: number): number {
	const sorted = [...frames].sort((a, b) => a.time - b.time);
	if (time <= sorted[0]!.time) return sorted[0]!.value;
	for (let index = 1; index < sorted.length; index++) {
		const to = sorted[index]!;
		if (time <= to.time) {
			const from = sorted[index - 1]!;
			return from.value + ((to.value - from.value) * (time - from.time)) / (to.time - from.time);
		}
	}
	return sorted.at(-1)!.value;
}

describe('camera move recipes', () => {
	const move = (kind: 'impact_shake' | 'whip' | 'push_in' | 'beat_pulse' | 'handheld' | 'white_flash', extra: Record<string, unknown> = {}) =>
		({ kind, start: 0, duration: 0.3, strength: 1, seed: 7, ...extra }) as Parameters<typeof moveDelta>[0];

	it('shake decays to rest, inside its amplitude', () => {
		const shake = move('impact_shake');
		expect(Math.hypot(moveDelta(shake, 0.3).offsetX, moveDelta(shake, 0.3).offsetY)).toBeCloseTo(0, 6);
		for (let t = 0; t <= 0.3; t += 0.01) expect(Math.abs(moveDelta(shake, t).offsetX)).toBeLessThanOrEqual(40);
		expect(moveDelta(shake, 0.1)).toEqual(moveDelta({ ...shake }, 0.1));
		expect(moveDelta(shake, 0.1)).not.toEqual(moveDelta({ ...shake, seed: 8 }, 0.1));
	});

	it('whip throws out and back; push-in eases to its amount; pulse returns', () => {
		expect(moveDelta(move('whip', { direction: 'left' }), 0.15).offsetX).toBeCloseTo(-160, 3);
		expect(moveDelta(move('whip'), 0.3).offsetX).toBeCloseTo(0, 6);
		expect(moveDelta(move('push_in', { duration: 2, strength: 0 }), 2).scale).toBeCloseTo(0.02, 6);
		expect(moveDelta(move('push_in', { duration: 2 }), 1).scale).toBeCloseTo(0.35, 6);
		expect(moveDelta(move('beat_pulse', { duration: 0.25 }), 0.125).scale).toBeCloseTo(0.15, 6);
		expect(moveDelta(move('beat_pulse', { duration: 0.25 }), 0.25).scale).toBeCloseTo(0, 6);
	});

	it('handheld ramps in and out over 0.4 s', () => {
		const drift = move('handheld', { duration: 4 });
		expect(moveDelta(drift, 0).offsetX).toBe(0);
		expect(moveDelta(drift, 4).offsetY).toBeCloseTo(0, 6);
		for (let t = 0; t <= 4; t += 0.05) expect(Math.abs(moveDelta(drift, t).offsetX)).toBeLessThanOrEqual(12);
	});

	it('flash rises in 40 ms and falls away', () => {
		const flash = move('white_flash', { duration: 0.25 });
		expect(flashOpacity(flash, 0)).toBe(0);
		expect(flashOpacity(flash, 0.04)).toBeCloseTo((1 - 0.04 / 0.25) ** 2, 6);
		expect(flashOpacity(flash, 0.25)).toBe(0);
	});
});

describe('add_camera_move', () => {
	it('bakes a shake on the words into keyframes on the speaker, and keeps the frame covered', async () => {
		const ctx = memory();
		const { document, results } = await applyOps(SOURCE, [{ op: 'add_camera_move', kind: 'impact_shake', quote: 'ten thousand users', strength: 1 }], ctx);
		expect(results[0]!.summary).toBe('Add an impact shake');
		validate(document);
		const [video] = videos(document);
		const offset = track(video!, 'offsetX')!;
		const scale = track(video!, 'scale')!;
		expect(offset && scale && track(video!, 'offsetY') && track(video!, 'rotation')).toBeTruthy();
		// "ten" is at clip second 1 (source 3): rest one frame before, a hit at the word, rest again at the end.
		expect(at(offset.keyframes, 3 - 0.033)).toBe(0);
		expect(Math.abs(at(offset.keyframes, 3)!)).toBeGreaterThan(1);
		expect(at(offset.keyframes, 3.3)).toBeCloseTo(0, 2);
		expect(at(scale.keyframes, 3 - 0.033)).toBe(1);
		expect(Math.max(...scale.keyframes.map((frame) => frame.value))).toBeGreaterThan(1);
		for (const frame of scale.keyframes) expect(covered(video!, frame.time)).toBe(true);
		// The face-tracking pan is not ours and stays.
		expect(video!.tracks!.find((item) => item.property === 'x')!.id).not.toMatch(/^camera-/);
	});

	it('allows one shake or flash per 20 s', async () => {
		const ctx = memory();
		const once = await applyOps(SOURCE, [{ op: 'add_camera_move', kind: 'impact_shake', start: 1 }], ctx);
		await expect(applyOps(once.document, [{ op: 'add_camera_move', kind: 'white_flash', start: 10 }], ctx)).rejects.toThrow(/one shake or flash per 20 s/);
		const twice = await applyOps(once.document, [{ op: 'add_camera_move', kind: 'white_flash', start: 22 }], ctx);
		const flash = nodes(twice.document).find((node) => node.kind === 'rect') as unknown as { start: number; end: number; tracks: Track[] };
		expect(flash.start).toBe(22);
		expect(flash.end).toBe(22.25);
		expect(Math.max(...flash.tracks[0]!.keyframes.map((frame) => frame.value))).toBeGreaterThan(0.5);
		// Captions stay above the flash.
		expect((nodes(twice.document).find((node) => node.kind === 'scene') as unknown as { children: { kind: string }[] }).children.at(-1)!.kind).toBe('captions');
	});

	it('replaces the move on the same words instead of stacking a second', async () => {
		const ctx = memory();
		const once = await applyOps(SOURCE, [{ op: 'add_camera_move', kind: 'push_in', start: 4, strength: 0.2 }], ctx);
		const twice = await applyOps(once.document, [{ op: 'add_camera_move', kind: 'push_in', start: 4.5, strength: 0.5 }], ctx);
		const moves = (twice.document.stage.children[0] as unknown as { marks: Record<string, { moves: { strength: number }[] }> }).marks['camera-moves']!.moves;
		expect(moves).toHaveLength(1);
		expect(moves[0]!.strength).toBe(0.5);
	});

	it('holds a push-in until the next cut, and follows the speaker when words are cut', async () => {
		const ctx = memory();
		const pushed = await applyOps(SOURCE, [{ op: 'add_camera_move', kind: 'push_in', start: 0.5, duration: 1, strength: 0.5 }], ctx);
		const scale = track(videos(pushed.document)[0]!, 'scale')!;
		// No cut: the close shot holds to the end of the master.
		expect(scale.keyframes.at(-1)).toMatchObject({ time: 32, value: 1.21 });
		const um = normalize(TRANSCRIPT).flatMap((segment) => segment.words).find((item) => item.text === 'um')!.id!;
		const cut = await applyOps(pushed.document, [{ op: 'remove_words', word_ids: [um] }], ctx);
		const [first, second] = videos(cut.document);
		expect(track(first!, 'scale')!.keyframes.at(-1)!.value).toBe(1.21);
		// The piece after the cut starts wide: the jump back is the cut.
		expect(track(second!, 'scale')).toBeUndefined();
	});

	it('refuses where a layout shrinks the speaker, and outside the clip', async () => {
		const ctx = memory();
		const split = structuredClone(SOURCE) as unknown as { stage: { children: { marks: Record<string, unknown> }[] } };
		split.stage.children[0]!.marks.layout = { ranges: [{ start: 5, end: 10, mode: 'split-top' }] };
		await expect(applyOps(split as unknown as ClipDocument, [{ op: 'add_camera_move', kind: 'beat_pulse', start: 6 }], ctx)).rejects.toThrow(/layout shrinks the speaker/);
		await expect(applyOps(SOURCE, [{ op: 'add_camera_move', kind: 'handheld', start: 29, duration: 4 }], ctx)).rejects.toThrow(/must end inside the clip/);
		await expect(applyOps(SOURCE, [{ op: 'add_camera_move', kind: 'whip' }], ctx)).rejects.toThrow(/Give start/);
	});

	it('remove_camera_moves takes the keyframes and the flash away', async () => {
		const ctx = memory();
		const moved = await applyOps(
			SOURCE,
			[
				{ op: 'add_camera_move', kind: 'handheld', start: 2, duration: 3 },
				{ op: 'add_camera_move', kind: 'white_flash', start: 25 },
			],
			ctx,
		);
		const one = await applyOps(moved.document, [{ op: 'remove_camera_moves', at: 3 }], ctx);
		expect(track(videos(one.document)[0]!, 'offsetX')).toBeUndefined();
		expect(nodes(one.document).some((node) => node.kind === 'rect')).toBe(true);
		const none = await applyOps(one.document, [{ op: 'remove_camera_moves' }], ctx);
		expect(nodes(none.document).some((node) => node.kind === 'rect')).toBe(false);
		expect(videos(none.document)[0]!.tracks).toMatchObject((SOURCE.stage.children[0] as unknown as { children: Video[] }).children[0]!.tracks!);
		await expect(applyOps(none.document, [{ op: 'remove_camera_moves' }], ctx)).rejects.toThrow(/no camera moves/);
	});

	it('leaves a document without moves untouched', async () => {
		const { document } = await applyOps(SOURCE, [{ op: 'set_workarea', start: 0, end: 30 }], memory());
		expect(videos(document)[0]!.tracks).toHaveLength(1);
	});
});
