/**
 * The job contract shared by the CLI, the worker (Track B) and the Assistant tools (Track C).
 * Fixed in docs/explainer-build.md; change it only through a Request there.
 */

import { z } from 'zod';

export const FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] } as const;
export const FPS = 30;
export const MAX_CODE_CHARS = 32_000; // same as scene_codes

export const BeatSchema = z.object({
	say: z.string().trim().min(1).max(240), // narration for this beat
	label: z.string().trim().max(40).optional(), // main on-screen words (≤ 5 words, checked by the guide/reviewer)
}).strict();

export const WordSchema = z.object({ text: z.string(), start: z.number().min(0), end: z.number().min(0) }).strict();

export const MotionJobSchema = z.object({
	title: z.string().trim().min(1).max(60),
	code: z.string().min(1).max(MAX_CODE_CHARS), // TSX written by the Assistant (see "Scene code")
	beats: z.array(BeatSchema).min(3).max(16),
	format: z.enum(['16:9', '9:16', '1:1']),
	duration: z.number().int().min(10).max(90), // seconds of video
	seed: z.number().int().min(0).max(2_147_483_647).default(0),
	accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), // Brand Kit accent
	words: z.array(WordSchema).optional(), // real timings; absent = estimated from beats
}).strict();

export type Beat = z.infer<typeof BeatSchema>;
export type Word = z.infer<typeof WordSchema>;
export type MotionJob = z.infer<typeof MotionJobSchema>;
export type MotionFormat = MotionJob['format'];

export type PreviewResult =
	| { ok: true; stills: { t: number; file: string }[]; issues: string[]; estimated: boolean }
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
