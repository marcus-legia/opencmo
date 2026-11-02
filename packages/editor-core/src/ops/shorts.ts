/**
 * `make_short` (P2 B4, Shorts squad Builder): the document of a short cut from a finished edit.
 *
 * A short is its own edit (`clips.kind = short`), so this op does not change the parent: it returns a
 * new document made from the parent's active timeline, with the work area on the range (export draws
 * the active timeline over its work area) and a 9:16 frame through `set_frame`, so captions, punch-ins
 * and the face track come along exactly as the founder left them. It is not in the op registry:
 * applied to the parent's own document it would replace the finished edit with the short.
 */

import { z } from 'zod';

import { FRAME_RATE as FPS, type ClipDocument } from '@opencmo/clip-doc';

import { isVoiceoverCaptions, speechOffset, speechRate, speechSources } from '../captions';
import { activeView, clone, timelinesOf, viewOf, type Entity } from '../doc';
import { clipWords } from '../script';
import { normalize, round } from '../transcript';
import { loadCaptions } from './captions';
import { OpFailure, type OpContext } from './context';
import { shotSource } from './create-video';
import { setFrame } from './project';
import { timesOf } from './timeline';

/** Longest short any platform takes (YouTube Shorts allows 3 minutes); the reviewer holds 15–60 s. */
export const MAX_SHORT_SECONDS = 180;

export const SHORT_FRAME = { width: 1080, height: 1920 } as const;

const at = z.number().finite().min(0).max(24 * 3600);

export const makeShortInput = z
	.object({ op: z.literal('make_short'), start: at, end: at, name: z.string().trim().min(1).max(60).optional() })
	.refine((input) => input.end > input.start, 'The short must end after it starts.')
	.refine((input) => input.end - input.start <= MAX_SHORT_SECONDS, `A short is at most ${MAX_SHORT_SECONDS} seconds.`);

export type MakeShort = { start: number; end: number; name?: string };

const seconds = (frames: number): number => Math.round((frames / FPS) * 1e4) / 1e4;

export const makeShort = {
	name: 'make_short',
	input: makeShortInput,
	describe: (input: MakeShort) => `Cut a short from ${input.start}s to ${input.end}s`,
	async apply(parent: ClipDocument, input: MakeShort, ctx: OpContext): Promise<ClipDocument> {
		const scenes = timelinesOf(parent);
		const active = scenes.find((scene) => scene.active) ?? scenes[0];
		if (!active) throw new OpFailure('This edit has no timeline to cut a short from.');
		const start = Math.round(input.start * FPS);
		const end = Math.round(input.end * FPS);
		if (end <= start) throw new OpFailure('The short must end after it starts.');
		// One timeline: the short is approved, scheduled and posted on its own.
		const document = clone(viewOf(parent, active));
		const kept = timelinesOf(document)[0] as unknown as Entity;
		kept.active = true;
		kept.name = input.name ?? 'Short';
		kept.x = 0;
		kept.y = 0;
		kept.workarea = [seconds(start), seconds(end)];
		delete kept.playhead;
		return setFrame.apply(document, { width: SHORT_FRAME.width, height: SHORT_FRAME.height, mode: 'fill' }, ctx);
	},
};

/** A spoken word or a shot, in seconds of the edit's active timeline (what `make_short` cuts by). */
export type TimelineSpan = { start: number; end: number };
export type SpokenWord = TimelineSpan & { text: string };

/**
 * Every word still heard on the active timeline, in its seconds: each video's kept speech (after
 * text cuts) at its place and speed, and each voice-over's word timings. The Shorts squad cuts by them.
 */
export async function spokenWords(document: ClipDocument, ctx: Pick<OpContext, 'readTranscript' | 'media'>): Promise<SpokenWord[]> {
	const view = activeView(document);
	const words: SpokenWord[] = [];
	for (const source of speechSources(view)) {
		const id = source.elementId || undefined;
		const model = await loadCaptions(view, ctx, id);
		if (!model) continue;
		const offset = speechOffset(view, id);
		const rate = speechRate(view, id) || 1;
		for (const word of clipWords(model.transcript, model.window, model.removed)) {
			words.push({ text: word.text, start: round(offset + word.start / rate), end: round(offset + word.end / rate) });
		}
	}
	for (const [node, time] of timesOf(view, ctx)) {
		const src = (node as { src?: unknown }).src;
		if (!isVoiceoverCaptions(node) || typeof src !== 'string') continue;
		const origin = time.origin / FPS;
		for (const segment of normalize(await ctx.readTranscript(src))) {
			for (const word of segment.words) words.push({ text: word.text, start: round(origin + word.start), end: round(origin + word.end) });
		}
	}
	return words.sort((a, b) => a.start - b.start);
}

/** The AI video shots on the active timeline (a long take's beats), in timeline seconds; empty for other edits. */
export function shotBeats(document: ClipDocument, ctx: Pick<OpContext, 'media'>): TimelineSpan[] {
	const beats: TimelineSpan[] = [];
	for (const [node, time] of timesOf(activeView(document), ctx)) {
		if (shotSource(node as unknown as Entity)) beats.push({ start: seconds(time.start), end: seconds(time.end) });
	}
	return beats.sort((a, b) => a.start - b.start);
}
