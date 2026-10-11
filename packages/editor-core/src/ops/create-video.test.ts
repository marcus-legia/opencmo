import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { applyOps, type OpContext } from './index';

const ctx = { media: { duration: () => null }, readTranscript: async () => [], saveTranscript: async () => 'x' } as unknown as OpContext;
const blank = validate({
	version: 1,
	stage: { children: [{ kind: 'scene', id: 'sc', width: 1080, height: 1920, fill: '#000000', workarea: [0, 10], active: true, children: [] }] },
}) as ClipDocument;

const shot = (start: number, length: number, text?: string) => ({
	start,
	length,
	model: 'fake-video',
	prompt: `shot at ${start}`,
	seed: Math.round(start * 10) + 1,
	duration: 5,
	...(text ? { text } : {}),
});

const video = {
	op: 'create_video',
	aspect: '16:9',
	seconds: 12,
	shots: [shot(0, 5, 'Meet Hotelly'), shot(5, 4), shot(9, 3)],
	voice: { text: 'Run your hotel from one screen. Bookings, rooms and guests in one place.', voice: 'Test A', seed: 9 },
	music: { model: 'fake-sfx', prompt: 'calm cinematic bed', seed: 4, duration: 12 },
};

type Node = Record<string, unknown> & { children?: Node[]; paints?: { src: Record<string, unknown> }[]; src?: Record<string, unknown> };
const flat = (nodes: Node[]): Node[] => nodes.flatMap((node) => [node, ...flat(node.children ?? [])]);

describe('create_video', () => {
	it('places every shot back to back, the voice-over with captions, music and text on a 16:9 frame', async () => {
		const { document } = await applyOps(blank, [video], ctx);
		const scene = document.stage.children[0] as unknown as Node;
		expect(scene).toMatchObject({ width: 1920, height: 1080, workarea: [0, 12] });
		const all = flat(scene.children!);
		const shots = all.filter((node) => node.paints?.[0]?.src?.generate === 'video');
		expect(shots.map((node) => [node.start ?? 0, node.end])).toEqual([[0, 5], [5, 9], [9, 12]]);
		expect(shots[0]).toMatchObject({ muted: true, width: 1920, height: 1080 });
		expect(shots[1]!.paints![0]!.src).toMatchObject({ generate: 'video', model: 'fake-video', aspectRatio: '16:9', duration: 5, seed: 51 });
		expect(all.find((node) => node.src?.generate === 'voice')).toMatchObject({ start: 0 });
		expect(all.some((node) => node.kind === 'captions')).toBe(true);
		expect(all.find((node) => node.src?.generate === 'audio')).toMatchObject({ volume: -18 });
		expect(all.find((node) => node.kind === 'text')).toMatchObject({ text: 'Meet Hotelly', start: 0, end: 5 });
		expect(() => validate(document)).not.toThrow();
	});

	it('refuses shots that leave a gap or do not cover the video', async () => {
		await expect(applyOps(blank, [{ ...video, shots: [shot(0, 5), shot(6, 4), shot(10, 2)] }], ctx)).rejects.toThrow(/should start at 5s/);
		await expect(applyOps(blank, [{ ...video, seconds: 20 }], ctx)).rejects.toThrow(/cover 12s/);
		await expect(applyOps(blank, [{ ...video, shots: [{ ...shot(0, 12), duration: 5 }] }], ctx)).rejects.toThrow(/only 5s are generated/);
	});
});
