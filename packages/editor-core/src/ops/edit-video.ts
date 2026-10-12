/**
 * Edit the speaker's own video with words ("make it night", "turn the room into a studio") for one
 * range of the clip: a video-to-video model redraws that range, and the result plays over the
 * original in the same box. The original keeps playing underneath for its sound.
 *
 * The result is a generation declaration like any AI media, so it holds its own credits; the op
 * places it in one revision, so Approve and Undo are one step.
 */

import { z } from 'zod';

import type { AssetDeclaration, ClipDocument } from '@opencmo/clip-doc';

import { clone, MASTER_SRC, sceneOf, type Entity } from '../doc';
import { aiModel } from '../generate';
import { frameAspect, masterFor, shiftTrack, type Track } from './background';
import { OpFailure, type OpContext } from './context';
import { checked } from './project';

/** Lengths the edit models take when the catalog does not say (Kling O1 Edit: 3–10 s). */
const DEFAULT_SECONDS = [3, 4, 5, 6, 7, 8, 9, 10];

export const editVideoInput = z.object({
	op: z.literal('edit_video'),
	start: z.number().finite().min(0),
	end: z.number().finite().min(0),
	model: z.string().min(1).max(100),
	/** What to change in the picture; the motion and camera stay. */
	prompt: z.string().trim().min(1).max(2500),
	seed: z.number().int().min(0).max(2_147_483_647),
});
export type EditVideo = z.infer<typeof editVideoInput>;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Seconds one edit may cover with this model. */
export function editSeconds(model: string): number[] {
	return aiModel(model)?.limits.durations ?? DEFAULT_SECONDS;
}

/** The declaration and the layer the op inserts; the agent and the panel price the same declaration. */
export function planVideoEdit(document: ClipDocument, input: EditVideo, ctx?: Pick<OpContext, 'media'>) {
	const length = round(input.end - input.start);
	if (!(length > 0)) throw new OpFailure('Pick a range to edit.');
	const allowed = editSeconds(input.model);
	const seconds = Math.ceil(length - 1e-6);
	const min = Math.min(...allowed);
	const max = Math.max(...allowed);
	if (!allowed.includes(seconds)) throw new OpFailure(`Edit ${min} to ${max} seconds at a time.`);
	const scene = sceneOf(document);
	if (!scene) throw new OpFailure('This project has no scene.');
	const master = masterFor(document, input.start, input.end, ctx);
	const declaration = {
		generate: 'video',
		model: input.model,
		prompt: input.prompt,
		aspectRatio: frameAspect(Number(scene.width), Number(scene.height)),
		duration: seconds,
		sourceVideo: MASTER_SRC,
		sourceStart: master.sourceStart,
		seed: input.seed,
	} as AssetDeclaration;
	const node = master.node;
	const geometry = Object.fromEntries(
		['x', 'y', 'width', 'height'].filter((key) => node[key] !== undefined).map((key) => [key, node[key]]),
	);
	// Face tracking moves the speaker's box; the edit follows the same keyframes.
	const tracks = ((node.tracks as Track[] | undefined) ?? []).filter((track) => ['x', 'y'].includes(track.property)).map((track) => shiftTrack(track, master.offset));
	const layer = {
		kind: 'rect',
		name: 'AI edit',
		...geometry,
		start: round(input.start),
		end: round(input.end),
		// The original underneath keeps the sound.
		muted: true,
		marks: { visual: { op: 'edit_video', input } },
		...(tracks.length ? { tracks } : {}),
		paints: [{ type: 'video', src: declaration, objectFit: (node.objectFit as string | undefined) ?? 'cover', ...(node.objectPosition ? { objectPosition: node.objectPosition } : {}) }],
	};
	return { layer, declaration, owner: master.owner };
}

export const editVideo = {
	name: 'edit_video',
	agent: false,
	input: editVideoInput,
	describe: () => 'Edit the video with AI',
	async apply(document: ClipDocument, input: EditVideo, ctx?: OpContext) {
		const next = clone(document);
		const { layer, owner } = planVideoEdit(next, input, ctx);
		const children = sceneOf(next)!.children as unknown as Entity[];
		// Right above the speaker, below captions and anything placed on top of them.
		children.splice(children.indexOf(owner) + 1, 0, layer as unknown as Entity);
		return checked(next, 'The video cannot be edited here');
	},
};
