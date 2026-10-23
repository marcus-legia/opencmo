/**
 * A whole AI video in one op: the storyboard the Director planned, placed on a blank edit. Every
 * shot is its own video declaration (all generated in parallel), with the voice-over, captions,
 * on-screen text and a music bed. Built from the existing ops, so each piece is exactly what the
 * editor would write by hand — and the editor resolves the declarations the server already paid for.
 *
 * The shots go in one sequence named after the video: one block on the timeline the user moves,
 * trims and deletes as a scene. The voice and music span every shot, and a sequence plays its
 * clips one after another on one row, so they keep rows of their own.
 */

import { z } from 'zod';

import type { ClipDocument } from '@opencmo/clip-doc';

import { byId, clone, same, sceneOf, walk, type Entity } from '../doc';
import { belowText, rowName } from '../tracks';
import { OpFailure, type OpContext } from './context';
import { addGenerated, addText, keyframeSource, MAX_CHAIN, setFrame, type KeyframeSource } from './project';
import { detach, setWorkarea } from './timeline';
import { addVoiceover } from './voiceover';

export const VIDEO_ASPECTS = ['9:16', '16:9', '1:1'] as const;
export const VIDEO_FRAMES: Record<(typeof VIDEO_ASPECTS)[number], { width: number; height: number }> = {
	'9:16': { width: 1080, height: 1920 },
	'16:9': { width: 1920, height: 1080 },
	'1:1': { width: 1080, height: 1080 },
};
/** 18 shots + voice + music = 20 generations, under the 24 a user may have in flight (`generation_active_limit`). */
export const MAX_SHOTS = 18;
/** Keyframes of one long take: one more than its shots when every shot joins the next. */
const KEYFRAMES_LIMIT = MAX_SHOTS + 1;

const seed = z.number().int().min(0).max(2_147_483_647);
const seconds = z.number().finite().min(0).max(600);

export const createVideoInput = z.object({
	op: z.literal('create_video'),
	aspect: z.enum(VIDEO_ASPECTS),
	seconds: z.number().finite().min(3).max(180),
	/** The video's name: the sequence that holds its shots carries it. */
	title: z.string().trim().min(1).max(80).optional(),
	shots: z
		.array(
			z.object({
				start: seconds,
				length: z.number().finite().min(0.5).max(60),
				model: z.string().min(1).max(100),
				prompt: z.string().trim().min(1).max(5000),
				seed,
				/** Seconds the model generates (one of its durations); the shot shows `length` of it. */
				duration: z.number().int().min(1).max(60),
				resolution: z.string().min(1).max(20).optional(),
				text: z.string().trim().min(1).max(80).optional(),
				/** Continues the previous shot (no cut): spec hash of that shot, whose last frame this one starts from. */
				after: z.string().regex(/^[0-9a-f]{64}$/).optional(),
				/** Long take: the keyframe the shot starts on, and the one it ends on (none = a cut after it). */
				start_frame: keyframeSource.optional(),
				end_frame: keyframeSource.optional(),
			}),
		)
		.min(1)
		.max(MAX_SHOTS),
	voice: z.object({ text: z.string().trim().min(1).max(5000), voice: z.string().min(1).max(100), seed }).optional(),
	/** One music generation; a video longer than it plays it again (paid once), see `apply`. */
	music: z.object({ model: z.string().min(1).max(100), prompt: z.string().trim().min(1).max(2000), seed, duration: z.number().int().min(1).max(60) }).optional(),
});
export type CreateVideo = z.infer<typeof createVideoInput>;

const TOLERANCE = 0.05;
/** Seconds of gain fade on each side of a seam where the music starts again. */
const SEAM = 1;

export { MAX_CHAIN };

/** Shots must play back to back from 0 to the end of the video, with no gap or overlap. */
export function checkShots(input: Pick<CreateVideo, 'seconds' | 'shots'>): string | null {
	let at = 0;
	let chain = 1;
	for (const [index, shot] of input.shots.entries()) {
		if (Math.abs(shot.start - at) > TOLERANCE) return `Shot ${index + 1} starts at ${shot.start}s; it should start at ${at}s, right after the previous one.`;
		if (shot.length > shot.duration + TOLERANCE) return `Shot ${index + 1} shows ${shot.length}s but only ${shot.duration}s are generated.`;
		if (shot.after && shot.start_frame) return `Shot ${index + 1} cannot both continue the shot before and start on a keyframe.`;
		if (shot.end_frame && !shot.start_frame) return `Shot ${index + 1} ends on a keyframe, so it must start on one too.`;
		// The next shot starts on the keyframe this one ends on: showing less of it would jump at the seam.
		const next = input.shots[index + 1];
		if (shot.end_frame && next?.start_frame && same(shot.end_frame, next.start_frame) && Math.abs(shot.length - shot.duration) > TOLERANCE) {
			return `Shot ${index + 1} must play all ${shot.duration}s to end on the keyframe shot ${index + 2} starts on.`;
		}
		if (shot.after) {
			const previous = input.shots[index - 1];
			if (!previous) return 'The first shot cannot continue another one.';
			// It starts from the previous shot's LAST frame: showing less of that shot would jump at the seam.
			if (Math.abs(previous.length - previous.duration) > TOLERANCE) return `Shot ${index} must play all ${previous.duration}s for shot ${index + 1} to continue it.`;
			chain += 1;
			if (chain > MAX_CHAIN) return `At most ${MAX_CHAIN} shots in a row can continue one another.`;
		} else {
			chain = 1;
		}
		at = Math.round((shot.start + shot.length) * 1000) / 1000;
	}
	if (Math.abs(at - input.seconds) > 0.5) return `The shots cover ${at}s; the video is ${input.seconds}s.`;
	return null;
}

export const createVideo = {
	name: 'create_video',
	agent: false,
	input: createVideoInput,
	describe: (input: CreateVideo) => `Create a ${Math.round(input.seconds)}s video (${input.shots.length} shots)`,
	async apply(document: ClipDocument, input: CreateVideo, ctx: OpContext) {
		const problem = checkShots(input);
		if (problem) throw new OpFailure(problem);
		const frame = VIDEO_FRAMES[input.aspect];
		let next = await setFrame.apply(document, { op: 'set_frame', ...frame } as never, ctx);
		next = await setWorkarea.apply(next, { op: 'set_workarea', start: 0, end: input.seconds } as never);
		for (const shot of input.shots) {
			next = await addGenerated.apply(
				next,
				{
					op: 'add_generated',
					kind: 'video',
					model: shot.model,
					prompt: shot.prompt,
					seed: shot.seed,
					aspect_ratio: input.aspect,
					duration: shot.duration,
					...(shot.resolution ? { resolution: shot.resolution } : {}),
					...(shot.after ? { after: shot.after } : {}),
					...(shot.start_frame ? { start_frame: shot.start_frame } : {}),
					...(shot.end_frame ? { end_frame: shot.end_frame } : {}),
					start: shot.start,
					length: shot.length,
					muted: true,
				} as never,
				ctx,
			);
		}
		next = gatherShots(next, input);
		for (const shot of input.shots) {
			if (!shot.text) continue;
			next = await addText.apply(next, { op: 'add_text', text: shot.text, start: shot.start, end: shot.start + shot.length, y: 0.2, bold: true } as never);
		}
		if (input.voice) {
			next = await addVoiceover.apply(
				next,
				{ op: 'add_voiceover', text: input.voice.text, voice: input.voice.voice, mode: 'overlay', start: 0, captions: true, seed: input.voice.seed },
				ctx,
			);
		}
		if (input.music) {
			// Music models stop at 60 s and audio has no loop: the same declaration plays again from
			// where it ends (one generation, paid once), the last copy is trimmed to the video, and
			// each seam crossfades in gain.
			const music = input.music;
			for (let start = 0; start < input.seconds - 0.05; start += music.duration) {
				next = await addGenerated.apply(
					next,
					{ op: 'add_generated', kind: 'audio', model: music.model, prompt: music.prompt, seed: music.seed, duration: music.duration, start, volume: -18 } as never,
					ctx,
				);
			}
			const copies: Entity[] = [];
			walk(next, ({ entity }) => {
				const src = entity.src as { generate?: string; seed?: number } | undefined;
				if (entity.kind === 'audio' && src?.generate === 'audio' && src.seed === music.seed) copies.push(entity);
			});
			copies.sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0));
			copies.forEach((copy, index) => {
				const last = index === copies.length - 1;
				if (last) copy.end = Math.min(Number(copy.end), input.seconds);
				if (copies.length === 1) return;
				copy.animations = [
					...(index > 0 ? [{ type: 'gain', phase: 'in', duration: SEAM }] : []),
					...(last ? [] : [{ type: 'gain', phase: 'out', duration: SEAM }]),
				];
			});
		}
		return next;
	},
};

/** Takes the shots out of the rows `add_generated` put them in and holds them in one named sequence. */
function gatherShots(document: ClipDocument, input: CreateVideo): ClipDocument {
	const shots: Entity[] = [];
	walk(document, ({ entity }) => {
		const paint = ((entity.paints as Entity[] | undefined) ?? [])[0];
		const src = paint?.src as Entity | undefined;
		if (src?.generate === 'video' && input.shots.some((shot) => shot.seed === src.seed && shot.prompt === src.prompt)) shots.push(entity);
	});
	shots.sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0));
	for (const shot of shots) detach(document, shot);
	const scene = sceneOf(document)!;
	const children = (scene.children ?? []) as unknown as Entity[];
	const sequence: Entity = { kind: 'sequence', name: input.title ?? rowName(document, 'visual'), children: shots };
	children.splice(belowText(children as never), 0, sequence);
	scene.children = children as never;
	return document;
}

/** A keyframe of a placed long take and the shots that start or end on it (at most two). */
export type PlacedKeyframe = { source: KeyframeSource; shots: { id: string; start: boolean; end: boolean }[] };

const shotSource = (shot: Entity): Entity | undefined => {
	const src = ((shot.paints as Entity[] | undefined) ?? [])[0]?.src as Entity | undefined;
	return src?.generate === 'video' ? src : undefined;
};

/**
 * The keyframes of the long take in sequence `sequenceId`, in the order its shots play them. Read
 * from the shots themselves, so it stays right after the user trims, moves or deletes a shot.
 * Null when the id is not a sequence of shots on keyframes.
 */
export function keyframesOf(document: ClipDocument, sequenceId: string): PlacedKeyframe[] | null {
	const found = byId(document, sequenceId);
	if (!found || found.entity.kind !== 'sequence') return null;
	const shots = ((found.entity.children as Entity[] | undefined) ?? []).filter((child) => shotSource(child)?.startFrame);
	shots.sort((a, b) => Number(a.start ?? 0) - Number(b.start ?? 0));
	const keyframes: PlacedKeyframe[] = [];
	const touch = (source: unknown, shot: Entity, edge: 'start' | 'end') => {
		if (!keyframeSource.safeParse(source).success) return;
		let last = keyframes.at(-1);
		if (!last || !same(last.source, source)) {
			last = { source: source as KeyframeSource, shots: [] };
			keyframes.push(last);
		}
		let use = last.shots.find((item) => item.id === shot.id);
		if (!use) last.shots.push((use = { id: String(shot.id), start: false, end: false }));
		use[edge] = true;
	};
	for (const shot of shots) {
		const src = shotSource(shot)!;
		touch(src.startFrame, shot, 'start');
		if (src.endFrame) touch(src.endFrame, shot, 'end');
	}
	return keyframes.length ? keyframes : null;
}

type RedoKeyframe = { op: 'redo_keyframe'; sequence_id: string; index: number; keyframe: KeyframeSource };

/**
 * Puts a new keyframe in place of keyframe `index` of a long take: the shots that start or end on
 * it are declared again with the new image, so they are made again and every other shot stays.
 * The old files stay in the library, and Undo brings back the old declarations. Not for the agent
 * directly: it costs credits, so it goes through `redo_keyframe`'s price card.
 */
export const redoKeyframe = {
	name: 'redo_keyframe',
	agent: false,
	input: z.object({
		op: z.literal('redo_keyframe'),
		sequence_id: z.string().min(1).max(64),
		index: z.number().int().min(0).max(KEYFRAMES_LIMIT - 1),
		keyframe: keyframeSource,
	}),
	describe: (input: RedoKeyframe) => `Redo keyframe ${input.index + 1}`,
	async apply(document: ClipDocument, input: RedoKeyframe) {
		const keyframes = keyframesOf(document, input.sequence_id);
		if (!keyframes) throw new OpFailure('That scene has no keyframes to redo.');
		const target = keyframes[input.index];
		if (!target) throw new OpFailure(`The scene has ${keyframes.length} keyframes; there is no keyframe ${input.index + 1}.`);
		if (same(target.source, input.keyframe)) throw new OpFailure(`Keyframe ${input.index + 1} is already that image.`);
		const next = clone(document);
		for (const use of target.shots) {
			const src = shotSource(byId(next, use.id)!.entity)!;
			if (use.start) src.startFrame = structuredClone(input.keyframe);
			if (use.end) src.endFrame = structuredClone(input.keyframe);
		}
		return next;
	},
};
