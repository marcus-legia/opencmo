/**
 * A whole AI video in one op: the storyboard the Director planned, placed on a blank edit. Every
 * shot is its own text-to-video declaration (all generated in parallel), with the voice-over,
 * captions, on-screen text and a music bed. Built from the existing ops, so each piece is exactly
 * what the editor would write by hand — and the editor resolves the declarations the server
 * already paid for.
 */

import { z } from 'zod';

import type { ClipDocument } from '@opencmo/clip-doc';

import { OpFailure, type OpContext } from './context';
import { addGenerated, addText, setFrame } from './project';
import { setWorkarea } from './timeline';
import { addVoiceover } from './voiceover';

export const VIDEO_ASPECTS = ['9:16', '16:9', '1:1'] as const;
export const VIDEO_FRAMES: Record<(typeof VIDEO_ASPECTS)[number], { width: number; height: number }> = {
	'9:16': { width: 1080, height: 1920 },
	'16:9': { width: 1920, height: 1080 },
	'1:1': { width: 1080, height: 1080 },
};
export const MAX_SHOTS = 24;

const seed = z.number().int().min(0).max(2_147_483_647);
const seconds = z.number().finite().min(0).max(600);

export const createVideoInput = z.object({
	op: z.literal('create_video'),
	aspect: z.enum(VIDEO_ASPECTS),
	seconds: z.number().finite().min(3).max(180),
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
			}),
		)
		.min(1)
		.max(MAX_SHOTS),
	voice: z.object({ text: z.string().trim().min(1).max(5000), voice: z.string().min(1).max(100), seed }).optional(),
	music: z.object({ model: z.string().min(1).max(100), prompt: z.string().trim().min(1).max(2000), seed, duration: z.number().int().min(1).max(600) }).optional(),
});
export type CreateVideo = z.infer<typeof createVideoInput>;

const TOLERANCE = 0.05;

/** Shots must play back to back from 0 to the end of the video, with no gap or overlap. */
export function checkShots(input: Pick<CreateVideo, 'seconds' | 'shots'>): string | null {
	let at = 0;
	for (const [index, shot] of input.shots.entries()) {
		if (Math.abs(shot.start - at) > TOLERANCE) return `Shot ${index + 1} starts at ${shot.start}s; it should start at ${at}s, right after the previous one.`;
		if (shot.length > shot.duration + TOLERANCE) return `Shot ${index + 1} shows ${shot.length}s but only ${shot.duration}s are generated.`;
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
					start: shot.start,
					length: shot.length,
					muted: true,
				} as never,
				ctx,
			);
		}
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
			next = await addGenerated.apply(
				next,
				{ op: 'add_generated', kind: 'audio', model: input.music.model, prompt: input.music.prompt, seed: input.music.seed, duration: input.music.duration, start: 0, volume: -18 } as never,
				ctx,
			);
		}
		return next;
	},
};
