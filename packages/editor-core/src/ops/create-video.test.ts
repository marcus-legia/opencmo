import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { applyOps, keyframesOf, type OpContext } from './index';

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

	it('plays one music generation again past its length, trimmed and crossfaded', async () => {
		const long = { ...video, seconds: 90, shots: Array.from({ length: 9 }, (_, index) => shot(index * 10, 10)).map((item) => ({ ...item, duration: 10 })), music: { ...video.music, duration: 60 } };
		const { document } = await applyOps(blank, [long], ctx);
		const music = flat((document.stage.children[0] as unknown as Node).children!).filter((node) => node.src?.generate === 'audio');
		expect(music.map((node) => [node.start ?? 0, node.end])).toEqual([[0, 60], [60, 90]]);
		expect(new Set(music.map((node) => JSON.stringify(node.src))).size).toBe(1);
		expect(music[0]!.animations).toMatchObject([{ type: 'gain', phase: 'out', duration: 1 }]);
		expect(music[1]!.animations).toMatchObject([{ type: 'gain', phase: 'in', duration: 1 }]);
		expect(() => validate(document)).not.toThrow();
	});

	it('refuses shots that leave a gap or do not cover the video', async () => {
		await expect(applyOps(blank, [{ ...video, shots: [shot(0, 5), shot(6, 4), shot(10, 2)] }], ctx)).rejects.toThrow(/should start at 5s/);
		await expect(applyOps(blank, [{ ...video, seconds: 20 }], ctx)).rejects.toThrow(/cover 12s/);
		await expect(applyOps(blank, [{ ...video, shots: [{ ...shot(0, 12), duration: 5 }] }], ctx)).rejects.toThrow(/only 5s are generated/);
	});

	it('writes a continuing shot with the hash of the shot it continues', async () => {
		const after = 'a'.repeat(64);
		const { document } = await applyOps(blank, [{ ...video, shots: [shot(0, 5), { ...shot(5, 4), after }, shot(9, 3)] }], ctx);
		const sources = flat(document.stage.children as unknown as Node[])
			.flatMap((node) => node.paints ?? [])
			.map((paint) => paint.src)
			.filter((src) => src && typeof src === 'object' && src.generate === 'video');
		expect(sources.map((src) => src.after)).toEqual([undefined, after, undefined]);
	});

	it('regenerating a shot repoints the shots that continue it', async () => {
		const after = 'a'.repeat(64);
		const { document } = await applyOps(blank, [{ ...video, seconds: 15, shots: [shot(0, 5), { ...shot(5, 5), after }, { ...shot(10, 5), after }] }], ctx);
		const shots = () => flat(document.stage.children as unknown as Node[]).filter((node) => (node.paints ?? []).some((paint) => paint.src?.generate === 'video'));
		const [first, second, third] = shots().map((node) => String(node.id));
		const continuations = [{ element_id: second!, after: 'b'.repeat(64) }, { element_id: third!, after: 'c'.repeat(64) }];
		const again = await applyOps(document, [{ op: 'regenerate', element_id: first!, seed: 9, continuations }], ctx);
		const sources = flat(again.document.stage.children as unknown as Node[])
			.flatMap((node) => node.paints ?? [])
			.map((paint) => paint.src)
			.filter((src) => src && typeof src === 'object' && src.generate === 'video');
		expect(sources.map((src) => [src.seed === 9, src.after])).toEqual([[true, undefined], [false, 'b'.repeat(64)], [false, 'c'.repeat(64)]]);
		// A continuation that is no longer a continuing shot: nothing is half-applied.
		await expect(applyOps(document, [{ op: 'regenerate', element_id: first!, seed: 9, continuations: [{ element_id: first!, after: 'b'.repeat(64) }] }], ctx)).rejects.toThrow(/continues this one/);
	});

	it('refuses a chain that cannot be seamless', async () => {
		const after = 'a'.repeat(64);
		await expect(applyOps(blank, [{ ...video, shots: [{ ...shot(0, 5), after }, shot(5, 4), shot(9, 3)] }], ctx)).rejects.toThrow(/first shot cannot continue/);
		// Shot 2 shows only 4 of its 5 s: shot 3 would start from a frame the viewer never saw.
		await expect(applyOps(blank, [{ ...video, shots: [shot(0, 5), shot(5, 4), { ...shot(9, 3), after }] }], ctx)).rejects.toThrow(/Shot 2 must play all 5s/);
		const chain = [shot(0, 5), { ...shot(5, 5), after }, { ...shot(10, 5), after }, { ...shot(15, 5), after }];
		await expect(applyOps(blank, [{ ...video, seconds: 20, shots: chain }], ctx)).rejects.toThrow(/At most 3 shots/);
	});

	describe('long take', () => {
		const keyframe = (index: number) => ({ generate: 'image' as const, prompt: `keyframe ${index}`, model: 'fake-image', aspectRatio: '16:9', seed: 100 + index });
		// Shots 1 and 2 join keyframes 0→1→2; shot 3 is a cut on keyframe 3.
		const longTake = {
			...video,
			title: 'Hotelly in one take',
			shots: [
				{ ...shot(0, 5), start_frame: keyframe(0), end_frame: keyframe(1) },
				{ ...shot(5, 5), start_frame: keyframe(1), end_frame: keyframe(2) },
				{ ...shot(10, 2), start_frame: keyframe(3) },
			],
		};
		const sequenceOf = (document: ClipDocument) => (document.stage.children[0] as unknown as Node).children!.find((node) => node.kind === 'sequence' && node.name === 'Hotelly in one take')!;

		it('holds every shot in one sequence named after the video, each on its keyframes', async () => {
			const { document } = await applyOps(blank, [longTake], ctx);
			const sequence = sequenceOf(document);
			expect(sequence.children!.map((node) => [node.start ?? 0, node.end])).toEqual([[0, 5], [5, 10], [10, 12]]);
			expect(sequence.children!.map((node) => [node.paints![0]!.src.startFrame, node.paints![0]!.src.endFrame])).toEqual([
				[keyframe(0), keyframe(1)],
				[keyframe(1), keyframe(2)],
				[keyframe(3), undefined],
			]);
			// No other row keeps a shot, and voice, music and captions stay outside the block.
			const scene = document.stage.children[0] as unknown as Node;
			const outside = scene.children!.filter((node) => node !== sequence);
			expect(flat(outside).some((node) => node.paints?.[0]?.src?.generate === 'video')).toBe(false);
			expect(flat(outside).some((node) => node.src?.generate === 'voice')).toBe(true);
			expect(() => validate(document)).not.toThrow();
		});

		it('moves the whole block, and trims and deletes its shots', async () => {
			const { document } = await applyOps(blank, [longTake], ctx);
			const sequence = sequenceOf(document);
			const moved = await applyOps(document, [{ op: 'move_elements', element_ids: [sequence.id], by: 2 }], ctx);
			expect(sequenceOf(moved.document).children!.map((node) => [node.start, node.end])).toEqual([[2, 7], [7, 12], [12, 14]]);
			const last = String(sequence.children![2]!.id);
			const trimmed = await applyOps(document, [{ op: 'trim_element', element_id: last, edge: 'out', at: 11 }], ctx);
			expect(sequenceOf(trimmed.document).children!.at(-1)).toMatchObject({ start: 10, end: 11 });
			const deleted = await applyOps(document, [{ op: 'delete_element', element_id: String(sequence.id) }], ctx);
			expect(flat((deleted.document.stage.children[0] as unknown as Node).children!).some((node) => node.paints?.[0]?.src?.generate === 'video')).toBe(false);
			for (const result of [moved, trimmed, deleted]) expect(() => validate(result.document)).not.toThrow();
		});

		it('refuses a seam that would jump or a shot that ends on a keyframe it does not start from', async () => {
			const [first, second, third] = longTake.shots;
			// Shot 1 shows 4 of its 5 s: shot 2 starts on the keyframe the viewer never reached.
			const trimmed = { ...longTake, shots: [{ ...first!, length: 4 }, { ...second!, start: 4 }, { ...third!, start: 9, length: 3 }] };
			await expect(applyOps(blank, [trimmed], ctx)).rejects.toThrow(/Shot 1 must play all 5s/);
			const { start_frame: _start, ...endOnly } = second!;
			await expect(applyOps(blank, [{ ...longTake, shots: [first!, endOnly, third!] }], ctx)).rejects.toThrow(/must start on one too/);
			await expect(applyOps(blank, [{ ...longTake, shots: [first!, { ...second!, after: 'a'.repeat(64) }, third!] }], ctx)).rejects.toThrow(/cannot both continue/);
		});
	});

	describe('redo keyframe', () => {
		const keyframe = (index: number) => ({ generate: 'image' as const, prompt: `keyframe ${index}`, model: 'fake-image', aspectRatio: '16:9', seed: 100 + index });
		// Six shots that each join the next keyframe: keyframes 0…6.
		const six = {
			...video,
			seconds: 30,
			title: 'Six shots',
			shots: Array.from({ length: 6 }, (_, index) => ({ ...shot(index * 5, 5), start_frame: keyframe(index), end_frame: keyframe(index + 1) })),
		};
		const placed = async () => {
			const { document } = await applyOps(blank, [six], ctx);
			const sequence = flat(document.stage.children as unknown as Node[]).find((node) => node.name === 'Six shots')!;
			return { document, id: String(sequence.id), shots: sequence.children!.map((node) => String(node.id)) };
		};
		const frames = (document: ClipDocument, id: string) =>
			(flat(document.stage.children as unknown as Node[]).find((node) => node.id === id)!.children ?? []).map((node) => [node.paints![0]!.src.startFrame, node.paints![0]!.src.endFrame]);
		const fresh = { ...keyframe(3), prompt: 'keyframe 3, warmer light', seed: 999 };

		it('reads the keyframes back in play order with the shots on each', async () => {
			const { document, id, shots } = await placed();
			const keyframes = keyframesOf(document, id)!;
			expect(keyframes.map((item) => item.source.prompt)).toEqual(Array.from({ length: 7 }, (_, index) => `keyframe ${index}`));
			expect(keyframes[0]!.shots).toEqual([{ id: shots[0], start: true, end: false }]);
			expect(keyframes[3]!.shots).toEqual([
				{ id: shots[2], start: false, end: true },
				{ id: shots[3], start: true, end: false },
			]);
			expect(keyframesOf(document, shots[0]!)).toBeNull();
		});

		it('redoing keyframe 3 changes exactly the two shots on it, and undo brings them back', async () => {
			const { document, id } = await placed();
			const before = frames(document, id);
			const { document: after } = await applyOps(document, [{ op: 'redo_keyframe', sequence_id: id, index: 3, keyframe: fresh }], ctx);
			const changed = frames(after, id);
			expect(changed.map((pair, index) => JSON.stringify(pair) !== JSON.stringify(before[index]))).toEqual([false, false, true, true, false, false]);
			expect(changed[2]![1]).toEqual(fresh);
			expect(changed[3]![0]).toEqual(fresh);
			// Undo restores the document the op started from; the op never touches it.
			expect(frames(document, id)).toEqual(before);
			expect(() => validate(after)).not.toThrow();
		});

		it('redoing keyframe 0 changes only the first shot', async () => {
			const { document, id } = await placed();
			const { document: after } = await applyOps(document, [{ op: 'redo_keyframe', sequence_id: id, index: 0, keyframe: { ...keyframe(0), seed: 7 } }], ctx);
			expect(frames(after, id).map((pair, index) => JSON.stringify(pair) !== JSON.stringify(frames(document, id)[index]))).toEqual([true, false, false, false, false, false]);
		});

		it('refuses a keyframe that is not there or would not change', async () => {
			const { document, id, shots } = await placed();
			await expect(applyOps(document, [{ op: 'redo_keyframe', sequence_id: id, index: 7, keyframe: fresh }], ctx)).rejects.toThrow(/there is no keyframe 8/);
			await expect(applyOps(document, [{ op: 'redo_keyframe', sequence_id: id, index: 2, keyframe: keyframe(2) }], ctx)).rejects.toThrow(/already that image/);
			await expect(applyOps(document, [{ op: 'redo_keyframe', sequence_id: shots[0]!, index: 0, keyframe: fresh }], ctx)).rejects.toThrow(/no keyframes/);
		});
	});
});
