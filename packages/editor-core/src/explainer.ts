/**
 * The explainer's data shapes, shared by the op, the Assistant's tools and the generation spec
 * check (`generate.ts`). No document code here: the light `./generate` entry imports it.
 * Mirrors the contract in `docs/explainer-build.md` and `packages/clip-motion/src/job.ts`.
 */

import { z } from 'zod';

export const EXPLAINER_MODEL = 'motion-explainer';
/** A silent 3–30 s motion piece (intros, product moments, logo reveals): same runtime, no voice. */
export const MOTION_CLIP_MODEL = 'motion-clip';

/** Same frames as `FORMATS` in `packages/clip-motion/src/job.ts`. */
export const EXPLAINER_FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] } as const;
export type ExplainerFormat = keyof typeof EXPLAINER_FORMATS;

/** Durations the model sells (`limits.durations`): 15–90 s in steps of 5. */
export const EXPLAINER_MIN_SECONDS = 15;
export const EXPLAINER_MAX_SECONDS = 90;
/** SQL caps a generation's `scene` at 4000 bytes (`create_generation`). */
export const EXPLAINER_SCENE_BYTES = 4000;

/** `jsonb::text` of a JSON value: Postgres writes `": "` and `", "`, so it is longer than `JSON.stringify`. */
function jsonbText(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value).filter(([, item]) => item !== undefined);
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`).join(', ')}}`;
	}
	return JSON.stringify(value);
}

/** Bytes of `scene` as SQL measures them (`octet_length((p_spec->'scene')::text)`). */
export const sceneBytes = (scene: unknown): number => new TextEncoder().encode(jsonbText(scene)).length;

export const ExplainerBeatSchema = z
	.object({
		say: z.string().trim().min(1).max(240),
		label: z.string().trim().max(40).optional(),
	})
	.strict();
export type ExplainerBeat = z.infer<typeof ExplainerBeatSchema>;

/** Same names and defaults as `THEMES` / `PERSONALITIES` in `packages/clip-motion/src/job.ts`. */
export const EXPLAINER_THEMES = ['blueprint', 'paper'] as const;
export type ExplainerTheme = (typeof EXPLAINER_THEMES)[number];
export const EXPLAINER_PERSONALITIES = ['premium', 'corporate', 'playful', 'energetic'] as const;
export type ExplainerPersonality = (typeof EXPLAINER_PERSONALITIES)[number];

/** Same rules as `ASSET_NAME` / `MAX_ASSETS` in `packages/clip-motion/src/job.ts`. */
export const MOTION_ASSET_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const MOTION_MAX_ASSETS = 6;

/** An image a scene shows by `name`: `ref` is the user's own library object; SQL and the worker check the owner. */
export const MotionAssetRefSchema = z
	.object({
		name: z.string().regex(MOTION_ASSET_NAME, 'Use lowercase letters, digits and dashes, starting with a letter (at most 32).'),
		ref: z.string().min(1).max(500),
	})
	.strict();
export type MotionAssetRef = z.infer<typeof MotionAssetRefSchema>;

const assetRefs = z
	.array(MotionAssetRefSchema)
	.max(MOTION_MAX_ASSETS)
	.refine((list) => new Set(list.map((asset) => asset.name)).size === list.length, 'Give each image a different name.');

/** The `scene` of a `motion-explainer` spec. The code itself lives in `scene_codes`, by hash. */
export const ExplainerSceneSchema = z
	.object({
		template: z.literal('explainer'),
		code_ref: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid scene code reference.'),
		title: z.string().trim().min(1).max(60),
		beats: z.array(ExplainerBeatSchema).min(3).max(16),
		accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
		theme: z.enum(EXPLAINER_THEMES).optional(),
		personality: z.enum(EXPLAINER_PERSONALITIES).optional(),
		assets: assetRefs.optional(),
	})
	.strict();
export type ExplainerScene = z.infer<typeof ExplainerSceneSchema>;

/** Same range as `CLIP_SECONDS` in `packages/clip-motion/src/job.ts`. */
export const CLIP_MIN_SECONDS = 3;
export const CLIP_MAX_SECONDS = 30;

/** A clip beat: `say` is the storyboard line (never voiced), `seconds` how long the beat lasts. */
export const ClipBeatSchema = z
	.object({
		say: z.string().trim().min(1).max(240),
		label: z.string().trim().max(40).optional(),
		seconds: z.number().min(0.5).max(30),
	})
	.strict();
export type ClipBeat = z.infer<typeof ClipBeatSchema>;

/** The `scene` of a `motion-clip` spec. */
export const ClipSceneSchema = z
	.object({
		template: z.literal('clip'),
		code_ref: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid scene code reference.'),
		title: z.string().trim().min(1).max(60),
		beats: z.array(ClipBeatSchema).min(1).max(8),
		accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
		theme: z.enum(EXPLAINER_THEMES).optional(),
		personality: z.enum(EXPLAINER_PERSONALITIES).optional(),
		assets: assetRefs.optional(),
	})
	.strict();
export type ClipScene = z.infer<typeof ClipSceneSchema>;

/** Seconds of a clip: its beats, rounded up to the whole second, inside 3–30 s. */
export const clipSeconds = (beats: readonly ClipBeat[]): number => {
	const total = beats.reduce((sum, beat) => sum + beat.seconds, 0);
	// Float sums like 0.1 + 0.2 must not round 3.0000000004 up to 4.
	return Math.min(CLIP_MAX_SECONDS, Math.max(CLIP_MIN_SECONDS, Math.ceil(total - 1e-9)));
};

/** The narration the voice reads: every beat's words, in order. */
export const narrationOf = (beats: readonly ExplainerBeat[]): string => beats.map((beat) => beat.say.trim()).join(' ');

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Narration estimate, as `estimateDuration` in `packages/clip-motion/src/job.ts`: 2.4 words/s plus a
 * 1.5 s tail, rounded up to 5 s. Not clamped: see `explainerSeconds`.
 */
export function estimateDuration(beats: readonly ExplainerBeat[]): number {
	const seconds = wordCount(narrationOf(beats)) / 2.4 + 1.5;
	return Math.ceil(seconds / 5) * 5;
}

/** Seconds of video the user pays for: the estimate, inside what the model sells. */
export const explainerSeconds = (beats: readonly ExplainerBeat[]): number =>
	Math.min(EXPLAINER_MAX_SECONDS, Math.max(EXPLAINER_MIN_SECONDS, estimateDuration(beats)));
