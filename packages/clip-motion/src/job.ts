/**
 * The job contract shared by the CLI, the worker (Track B) and the Assistant tools (Track C).
 * Fixed in docs/explainer-build.md; change it only through a Request there.
 */

import { z } from 'zod';

export const FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] } as const;
export const FPS = 30;
export const MAX_CODE_CHARS = 32_000; // same as scene_codes

/** `explainer` is narrated (beats timed by the voice); `clip` is silent, each beat lasting its own `seconds`. */
export const MOTION_KINDS = ['explainer', 'clip'] as const;
export type MotionKind = (typeof MOTION_KINDS)[number];

/** Images a scene shows through `kit.Image`: the user's own library media, inlined before Chromium opens. */
export const ASSET_NAME = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_ASSETS = 6;
export const MAX_ASSET_BYTES = 2_000_000;
export const MAX_ASSET_EDGE = 4096;
/** Preview stills the model may ask for by time (`stills`). */
export const MAX_PREVIEW_STILLS = 12;
/** An asset `src` after `stageAssets`: a file of the bundle's public dir that `kit.Image` loads with `staticFile`. */
export const STAGED_ASSET = 'bundle:';
/** Frames in one preview contact sheet (`sheet`). */
export const MAX_SHEET_FRAMES = 9;
export const CLIP_SECONDS = { min: 3, max: 30 } as const;
const BEAT_SECONDS = { min: 0.5, max: 30 } as const;

export const BeatSchema = z.object({
	say: z.string().trim().min(1).max(240), // narration for this beat (a clip's storyboard line, not voiced)
	label: z.string().trim().max(40).optional(), // main on-screen words (≤ 5 words, checked by the guide/reviewer)
	seconds: z.number().min(BEAT_SECONDS.min).max(BEAT_SECONDS.max).optional(), // clip beats only: how long it lasts
}).strict();

/**
 * Data URIs only, from the engine's one encoder (`motion_assets` for renders, `preview_assets` for previews): the same
 * pixels in both, and nothing in Node or Chromium fetches an image.
 */
export const AssetSchema = z.object({
	name: z.string().regex(ASSET_NAME, 'Use lowercase letters, digits and dashes, starting with a letter (at most 32).'),
	src: z.string().max(Math.ceil((MAX_ASSET_BYTES * 4) / 3) + 64).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, 'An asset is a PNG, JPEG or WebP data URI.'),
	width: z.number().int().min(1).max(MAX_ASSET_EDGE).optional(),
	height: z.number().int().min(1).max(MAX_ASSET_EDGE).optional(),
}).strict();

/** v2 looks: `blueprint` (navy field, v1) and `paper` (light, flat). */
export const THEMES = ['blueprint', 'paper'] as const;
/** v2 motion personalities, same names as `PERSONALITY` in packages/editor-core/src/motion/intro.ts. */
export const PERSONALITIES = ['premium', 'corporate', 'playful', 'energetic'] as const;
export type Theme = (typeof THEMES)[number];
export type Personality = (typeof PERSONALITIES)[number];
export const DEFAULT_THEME: Theme = 'blueprint';
export const DEFAULT_PERSONALITY: Personality = 'premium';

export const WordSchema = z.object({ text: z.string(), start: z.number().min(0), end: z.number().min(0) }).strict();

export const MotionJobSchema = z.object({
	kind: z.enum(MOTION_KINDS).optional(), // absent = explainer
	title: z.string().trim().min(1).max(60),
	code: z.string().min(1).max(MAX_CODE_CHARS), // TSX written by the Assistant (see "Scene code")
	beats: z.array(BeatSchema).min(1).max(16), // per-kind counts in the refinement below
	format: z.enum(['16:9', '9:16', '1:1']),
	duration: z.number().int().min(CLIP_SECONDS.min).max(90), // seconds of video; per-kind range below
	seed: z.number().int().min(0).max(2_147_483_647).default(0),
	accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), // Brand Kit accent
	words: z.array(WordSchema).optional(), // real timings; absent = estimated from beats
	theme: z.enum(THEMES).optional(), // absent = blueprint
	personality: z.enum(PERSONALITIES).optional(), // absent = premium, with v1 motion (no ambient layer by default)
	stills: z.array(z.number().finite().min(0)).max(MAX_PREVIEW_STILLS).optional(), // preview only: seconds to show
	// preview only: one contact sheet of `count` frames spread from `from` to `to` seconds (motion across a window)
	sheet: z.object({ from: z.number().finite().min(0), to: z.number().finite().min(0), count: z.number().int().min(2).max(MAX_SHEET_FRAMES) }).strict().refine((sheet) => sheet.to > sheet.from, 'sheet.to must be after sheet.from.').optional(),
	// preview only: a full-resolution crop of one frame (px of the composition), to check that resting text is crisp
	zoom: z.object({ t: z.number().finite().min(0), x: z.number().finite().min(0), y: z.number().finite().min(0), w: z.number().finite().min(16), h: z.number().finite().min(16) }).strict().optional(),
	assets: z.array(AssetSchema).max(MAX_ASSETS).optional(),
}).strict().superRefine((job, ctx) => {
	const names = new Set<string>();
	job.assets?.forEach((asset, i) => {
		if (names.has(asset.name)) ctx.addIssue({ code: 'custom', path: ['assets', i, 'name'], message: `Two images are named "${asset.name}": give each a different name.` });
		names.add(asset.name);
	});
	if ((job.kind ?? 'explainer') === 'explainer') {
		if (job.beats.length < 3) ctx.addIssue({ code: 'custom', path: ['beats'], message: 'An explainer has 3 to 16 beats.' });
		if (job.duration < 10) ctx.addIssue({ code: 'custom', path: ['duration'], message: 'An explainer lasts 10 to 90 seconds.' });
		return;
	}
	if (job.beats.length > 8) ctx.addIssue({ code: 'custom', path: ['beats'], message: 'A clip has 1 to 8 beats.' });
	if (job.duration > CLIP_SECONDS.max) ctx.addIssue({ code: 'custom', path: ['duration'], message: `A clip lasts ${CLIP_SECONDS.min} to ${CLIP_SECONDS.max} seconds.` });
	let total = 0;
	job.beats.forEach((beat, i) => {
		if (beat.seconds === undefined) ctx.addIssue({ code: 'custom', path: ['beats', i, 'seconds'], message: 'Every beat of a clip says how many seconds it lasts.' });
		else total += beat.seconds;
	});
	if (total > job.duration + 1e-9) ctx.addIssue({ code: 'custom', path: ['duration'], message: `The beats add up to ${Math.round(total * 100) / 100} s, longer than the clip's ${job.duration} s.` });
});

export type Beat = z.infer<typeof BeatSchema>;
export type Word = z.infer<typeof WordSchema>;
export type MotionJob = z.infer<typeof MotionJobSchema>;
export type MotionAsset = z.infer<typeof AssetSchema>;
export type MotionFormat = MotionJob['format'];

/** A preview image: a still at `t`, the contact sheet (`times` in reading order, `columns` per row) or the zoom crop. */
export type PreviewStill = { t: number; file: string; kind?: 'sheet' | 'zoom'; times?: number[]; columns?: number };

export type PreviewResult =
	| { ok: true; stills: PreviewStill[]; issues: string[]; estimated: boolean }
	| { ok: false; phase: 'job' | 'compile' | 'guard' | 'render'; message: string };

/** Narration pace used for estimates; ElevenLabs voices land close to it. */
export const WORDS_PER_SECOND = 2.4;
export const TAIL_SECONDS = 1.5;

export function countWords(text: string): number {
	return text.split(/\s+/).filter(Boolean).length;
}

/** Narration estimate used for `duration` and for previews: 2.4 words/s + 1.5 s tail, rounded up to 5 s. */
export function estimateDuration(beats: Beat[]): number {
	const words = beats.reduce((sum, beat) => sum + countWords(beat.say), 0);
	const seconds = words / WORDS_PER_SECOND + TAIL_SECONDS;
	return Math.min(90, Math.max(15, Math.ceil(seconds / 5) * 5));
}

export function frameSize(format: MotionFormat): { width: number; height: number } {
	const [width, height] = FORMATS[format];
	return { width, height };
}
