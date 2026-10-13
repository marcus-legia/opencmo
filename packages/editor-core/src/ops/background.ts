/**
 * Replace the background behind the speaker: an AI cut-out of the user's own video (stacked alpha,
 * no chroma key) over a new background, for one range of the clip.
 *
 * Both pieces are generation declarations: the editor resolves them like any AI media and each
 * holds its own credits. The op places them in one revision, so Approve and Undo are one step.
 */

import { z } from 'zod';

import type { AssetDeclaration, ClipDocument, ClipNode } from '@opencmo/clip-doc';
import { sampleTrack, type TimeNode } from '@opencmo/clip-render';

import { clone, isMaster, MASTER_SRC, sceneOf, type Entity } from '../doc';
import { OpFailure, type OpContext } from './context';
import { checked } from './project';
import { timesOf } from './timeline';

const FPS = 30;
/** Longest range one cut-out covers (the background-removal models take 1–15 s). */
export const MAX_SWAP_SECONDS = 15;
export const CUTOUT_PROMPT = 'Remove background';

const seed = z.number().int().min(0).max(2_147_483_647);
const generated = z.object({
	kind: z.enum(['image', 'video']),
	model: z.string().min(1).max(100),
	prompt: z.string().trim().min(1).max(5000),
	seed,
	duration: z.number().int().min(1).max(60).optional(),
	resolution: z.string().min(1).max(20).optional(),
});

export const replaceBackgroundInput = z.object({
	op: z.literal('replace_background'),
	start: z.number().finite().min(0),
	end: z.number().finite().min(0),
	cutout: z.object({ model: z.string().min(1).max(100), seed }),
	/** A new AI background, or a file already in the library. */
	background: z.union([generated, z.object({ path: z.string().min(1).max(500) })]),
});
export type ReplaceBackground = z.infer<typeof replaceBackgroundInput>;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Aspect ratio the models take that is closest to the frame. */
export function frameAspect(width: number, height: number): '9:16' | '16:9' | '1:1' {
	const ratio = width / height;
	return ratio < 0.8 ? '9:16' : ratio > 1.25 ? '16:9' : '1:1';
}

/** `offset`: seconds into the master node's own timeline where the range starts (its keyframes' clock). */
export type Master = { node: Entity; owner: Entity; sourceStart: number; offset: number };

const MOVING = ['x', 'y', 'offsetX', 'offsetY', 'scale', 'scaleX', 'scaleY', 'rotation'];

type MovingTrack = Parameters<typeof sampleTrack>[0];

const isRest = (key: string, value: number) => Math.abs(value - (key.startsWith('scale') ? 1 : 0)) < 1e-6;

/**
 * A parent that moves, scales or rotates its children at any frame of [from, to] (scene frames),
 * statically or with keyframes. apply_layout animates the Speaker group only where a split is on,
 * so a clip with a split later on still has a full-frame part the swap can use. Without timing
 * (`t`) any moving track counts.
 */
function movesChildren(entity: Entity, t: TimeNode | undefined, from: number, to: number): boolean {
	const tracks = ((entity.tracks as MovingTrack[] | undefined) ?? []).filter((track) => MOVING.includes(String(track.property)));
	return MOVING.some((key) => {
		const track = tracks.find((item) => item.property === key && item.keyframes.length);
		if (!track) {
			const value = entity[key];
			return typeof value === 'number' && !isRest(key, value);
		}
		if (!t) return true;
		// Same clock as the renderer: the node's local frame, keyframe times in seconds.
		const local = (frame: number) => Math.round((frame - t.origin) * t.rate);
		const [a, b] = [local(from), local(to)];
		const samples = [a, b, ...track.keyframes.map((keyframe) => keyframe.time * FPS).filter((frame) => frame > a && frame < b)];
		return samples.some((frame) => {
			const value = sampleTrack(track, frame);
			return typeof value === 'number' && !isRest(key, value);
		});
	});
}

/** The master piece that plays the whole range, and the scene child that holds it. */
export function masterFor(document: ClipDocument, start: number, end: number, ctx?: Pick<OpContext, 'media'>): Master {
	const scene = sceneOf(document);
	if (!scene) throw new OpFailure('This project has no scene.');
	const times = timesOf(document, { media: ctx?.media });
	const from = start * FPS;
	const to = end * FPS;
	for (const owner of (scene.children ?? []) as unknown as Entity[]) {
		const stack: { entity: Entity; transformed: boolean }[] = [{ entity: owner, transformed: false }];
		while (stack.length) {
			const { entity, transformed } = stack.pop()!;
			const t = times.get(entity as unknown as ClipNode);
			if (t && isMaster(entity as unknown as ClipNode) && t.start <= from + 1e-6 && t.end >= to - 1e-6) {
				// The cut-out copies the speaker's own box: a moved or scaled parent would put it elsewhere.
				if (transformed) throw new OpFailure('Turn off the layout on this part of the clip first.');
				return { node: entity, owner, sourceStart: round(((from - t.origin) * t.rate) / FPS), offset: round((from - t.start) / FPS) };
			}
			const moved = transformed || (!isMaster(entity as unknown as ClipNode) && movesChildren(entity, t, from, to));
			for (const child of (entity.children as Entity[] | undefined) ?? []) stack.push({ entity: child, transformed: moved });
		}
	}
	throw new OpFailure('Pick a part of your own video with no cut in it.');
}

export type Track = { property: string; keyframes: { time: number; value: number; easing?: string }[] };

function withoutIds(track: Track): Track {
	const { id: _id, ...rest } = track as Track & { id?: string };
	return { ...rest, keyframes: rest.keyframes.map(({ id: _key, ...key }: Track['keyframes'][number] & { id?: string }) => key) } as Track;
}

/** A track re-timed to start `offset` seconds later; the value at the new zero is kept (linear between keys). */
export function shiftTrack(track: Track, offset: number): Track {
	const keys = track.keyframes;
	const after = keys.findIndex((key) => key.time >= offset);
	const shifted = keys.filter((key) => key.time >= offset).map((key) => ({ ...key, time: round(key.time - offset) }));
	if (after !== 0 && keys.length) {
		const before = keys[(after < 0 ? keys.length : after) - 1]!;
		const next = after < 0 ? null : keys[after]!;
		const value = next ? before.value + ((next.value - before.value) * (offset - before.time)) / (next.time - before.time) : before.value;
		if (shifted[0]?.time !== 0) shifted.unshift({ ...before, time: 0, value: round(value) });
	}
	return { ...track, keyframes: shifted };
}

function declaration(model: string, aspectRatio: string, body: Partial<AssetDeclaration> & { generate: 'image' | 'video'; prompt: string }): AssetDeclaration {
	return { ...body, model, aspectRatio } as AssetDeclaration;
}

/** The declarations and the group the op inserts; the agent and the menu price the same declarations. */
export function planBackgroundSwap(document: ClipDocument, input: ReplaceBackground, ctx?: Pick<OpContext, 'media'>) {
	const length = round(input.end - input.start);
	if (!(length > 0)) throw new OpFailure('Pick a range to replace the background in.');
	if (length > MAX_SWAP_SECONDS) throw new OpFailure(`Replace the background in up to ${MAX_SWAP_SECONDS} seconds at a time.`);
	const scene = sceneOf(document)!;
	const master = masterFor(document, input.start, input.end, ctx);
	const aspectRatio = frameAspect(Number(scene.width), Number(scene.height));
	const seconds = Math.ceil(length - 1e-6);
	const cutout = declaration(input.cutout.model, aspectRatio, {
		generate: 'video',
		prompt: CUTOUT_PROMPT,
		duration: seconds,
		sourceVideo: MASTER_SRC,
		sourceStart: master.sourceStart,
		seed: input.cutout.seed,
	});
	const background =
		'path' in input.background
			? input.background.path
			: declaration(input.background.model, aspectRatio, {
					generate: input.background.kind,
					prompt: input.background.prompt,
					...(input.background.kind === 'video' ? { duration: input.background.duration ?? 5 } : {}),
					...(input.background.resolution ? { resolution: input.background.resolution } : {}),
					seed: input.background.seed,
				});
	const node = master.node;
	const geometry = Object.fromEntries(
		['x', 'y', 'width', 'height'].filter((key) => node[key] !== undefined).map((key) => [key, node[key]]),
	);
	// Face tracking moves the speaker's box; the cut-out follows the same keyframes. A copy, without
	// the ids: two elements with one id make the whole document unreadable. applyOps gives new ones.
	const tracks = ((node.tracks as Track[] | undefined) ?? [])
		.filter((track) => ['x', 'y'].includes(track.property))
		.map((track) => withoutIds(shiftTrack(track, master.offset)));
	const backgroundKind = 'path' in input.background ? (/\.(png|jpe?g|webp)$/i.test(input.background.path) ? 'image' : 'video') : input.background.kind;
	const group = {
		kind: 'group',
		name: 'Background swap',
		start: round(input.start),
		end: round(input.end),
		marks: { visual: { op: 'replace_background', input } },
		children: [
			{
				kind: 'rect',
				name: 'New background',
				x: 0,
				y: 0,
				width: scene.width,
				height: scene.height,
				start: 0,
				end: length,
				...(backgroundKind === 'video' ? { muted: true } : {}),
				paints: [{ type: backgroundKind, src: background, objectFit: 'cover' }],
			},
			{
				kind: 'rect',
				name: 'Speaker cut-out',
				...geometry,
				start: 0,
				end: length,
				muted: true,
				...(tracks.length ? { tracks } : {}),
				paints: [{ type: 'video', src: cutout, alpha: 'stacked', objectFit: (node.objectFit as string | undefined) ?? 'cover', ...(node.objectPosition ? { objectPosition: node.objectPosition } : {}) }],
			},
		],
	};
	return { group, cutout, background, owner: master.owner };
}

export const replaceBackground = {
	name: 'replace_background',
	agent: false,
	input: replaceBackgroundInput,
	describe: () => 'Replace the background',
	async apply(document: ClipDocument, input: ReplaceBackground, ctx?: OpContext) {
		const next = clone(document);
		const { group, owner } = planBackgroundSwap(next, input, ctx);
		const scene = sceneOf(next)!;
		const children = scene.children as unknown as Entity[];
		// Right above the speaker: the new background covers the original, the cut-out sits on top.
		children.splice(children.indexOf(owner) + 1, 0, group as unknown as Entity);
		return checked(next, 'The background cannot be replaced here');
	},
};
