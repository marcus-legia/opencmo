/**
 * The long take's shared contract: a plan of beats, each starting on a keyframe (a still made
 * first) and moving to the next one, so the shots join into what looks like one continuous film.
 * Stage 1 makes the keyframes, stage 2 the shots between them; the Assistant and MCP pass these
 * shapes from one stage to the next.
 */

import { z } from 'zod';

import { MAX_SHOTS, VIDEO_ASPECTS } from './ops/create-video';

/** One look for every keyframe and shot; `composePrompt` turns it into words. */
export const SHOT_STYLES = ['photo', 'cinematic', '3d-render', 'illustration', 'flat'] as const;

/** One beat of a long take: the words it covers, its first frame, and how it moves. */
export const LongTakeShotSchema = z.object({
	seconds: z.number().min(1).max(15),
	/** The exact slice of the script this beat covers. */
	words: z.string().min(1).max(600),
	/** First frame: subject, place, light, framing. Never text: image models garble it. */
	keyframe: z.string().min(3).max(300),
	/** Camera move, subject action, what moves around it. */
	motion: z.string().min(3).max(300),
	/** true: the shot ends on the next keyframe; false: a hard cut after it. */
	continues: z.boolean(),
	/** On-screen words, placed as an editor text layer so they stay editable and legible. */
	text: z.string().max(60).optional(),
});
export type LongTakeShot = z.infer<typeof LongTakeShotSchema>;

export const LongTakePlanSchema = z.object({
	title: z.string().min(1).max(80),
	script: z.string().min(1).max(3000),
	style: z.enum(SHOT_STYLES),
	music: z.string().min(1).max(200),
	shots: z.array(LongTakeShotSchema).min(1).max(MAX_SHOTS),
});
export type LongTakePlan = z.infer<typeof LongTakePlanSchema>;

/** Every shot continuous: one keyframe per shot plus the closing one. */
export const KEYFRAMES_MAX = MAX_SHOTS + 1;

/**
 * Which keyframe each shot starts and ends on (indexes into the plan's keyframes). A continuous shot
 * ends where the next one starts, so they share that frame; a cut shot ends wherever its motion
 * takes it, and the shot after it starts on a fresh keyframe. A continuous last shot ends on a
 * closing keyframe.
 */
export function keyframeIndexes(plan: Pick<LongTakePlan, 'shots'>): { start: number; end: number | null }[] {
	return plan.shots.map((shot, index) => ({ start: index, end: shot.continues ? index + 1 : null }));
}

/** Keyframes stage 1 makes for this plan. */
export function keyframeCount(plan: Pick<LongTakePlan, 'shots'>): number {
	return plan.shots.length + (plan.shots.at(-1)?.continues ? 1 : 0);
}

const keyframeRef = z.object({ generation_id: z.string().uuid(), index: z.number().int().min(0).max(KEYFRAMES_MAX - 1) });

/**
 * Stage 2 pays for shots between these keyframes, so the list must be exactly the plan's: one per
 * index 0..keyframeCount-1, no gap, no duplicate. A gap would leave a shot with no first frame.
 */
function checkKeyframes(value: { plan: Pick<LongTakePlan, 'shots'>; keyframes: { index: number }[] }, ctx: z.RefinementCtx): void {
	const want = keyframeCount(value.plan);
	const seen = new Set(value.keyframes.map((keyframe) => keyframe.index));
	if (value.keyframes.length !== want || seen.size !== want || [...seen].some((index) => index >= want)) {
		ctx.addIssue({ code: 'custom', path: ['keyframes'], message: `This plan needs keyframes 0 to ${want - 1}, each once.` });
	}
}

/** What stage 1 (`create_video`) hands to stage 2. */
export const CreateVideoResultSchema = z.object({
	plan: LongTakePlanSchema,
	aspect: z.enum(VIDEO_ASPECTS),
	seconds: z.number().min(1).max(180),
	keyframes: z.array(keyframeRef).min(1).max(KEYFRAMES_MAX),
	/** The shot model stage 1 timed and priced the plan with, so stage 2 makes the shots on that model. */
	model: z.string().min(1).max(100).optional(),
}).superRefine(checkKeyframes);
export type CreateVideoResult = z.infer<typeof CreateVideoResultSchema>;

/** Stage 2 (`animate_video`): the shots between the finished keyframes. */
export const AnimateVideoInputSchema = z.object({
	plan: LongTakePlanSchema,
	aspect: z.enum(VIDEO_ASPECTS),
	keyframes: z.array(keyframeRef).min(1).max(KEYFRAMES_MAX),
	voice: z.string().trim().max(40).optional(),
	/** `CreateVideoResult.model`, passed back as it came. */
	model: z.string().min(1).max(100).optional(),
}).superRefine(checkKeyframes);
export type AnimateVideoInput = z.infer<typeof AnimateVideoInputSchema>;

/** Redo one keyframe of a placed scene, with an optional new description. */
export const RedoKeyframeInputSchema = z.object({
	scene_id: z.string().min(1).max(100),
	index: z.number().int().min(0).max(KEYFRAMES_MAX - 1),
	keyframe: z.string().min(3).max(300).optional(),
});
export type RedoKeyframeInput = z.infer<typeof RedoKeyframeInputSchema>;
