/**
 * Beat and word timing in frames. Real ElevenLabs word timings when the job has them (render),
 * otherwise an estimate at the narration pace (preview), so the same scene code works for both.
 */

import { FPS, TAIL_SECONDS, WORDS_PER_SECOND, type MotionJob } from '../job.ts';

export type TimedWord = { text: string; key: string; frame: number };
export type BeatSpan = { from: number; to: number; frames: number; words: TimedWord[] };
export type Timeline = { estimated: boolean; frames: number; beats: BeatSpan[] };

export function wordKey(text: string): string {
	return text.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

function tokens(text: string): string[] {
	return text.split(/\s+/).filter(Boolean);
}

/**
 * A silent clip: each beat lasts its own `seconds`, back to back from frame 0; what is left after the last beat is
 * a hold on the end state. Its storyboard words are spread evenly over the beat, so `kit.cue` still lands inside it.
 */
function clipTimeline(job: Pick<MotionJob, 'beats' | 'duration'>): Timeline {
	const frames = job.duration * FPS;
	let from = 0;
	const beats = job.beats.map((beat) => {
		const to = Math.max(from + 1, Math.min(frames, from + Math.round((beat.seconds ?? 0) * FPS)));
		const list = tokens(beat.say);
		const span = { from, to, frames: to - from, words: list.map((text, k) => ({ text, key: wordKey(text), frame: from + Math.floor(((to - from) * k) / Math.max(1, list.length)) })) };
		from = to;
		return span;
	});
	return { estimated: false, frames, beats };
}

export function buildTimeline(job: Pick<MotionJob, 'beats' | 'duration' | 'words'> & { kind?: MotionJob['kind'] }): Timeline {
	if (job.kind === 'clip') return clipTimeline(job);
	const frames = job.duration * FPS;
	const last = frames - 1;
	const perBeat = job.beats.map((beat) => tokens(beat.say));
	const real = (job.words ?? []).filter((word) => word.text.trim());
	const estimated = real.length === 0;
	const timed: TimedWord[][] = [];

	if (estimated) {
		const total = perBeat.reduce((sum, list) => sum + list.length, 0);
		const narration = total / WORDS_PER_SECOND;
		const room = Math.max(1, job.duration - TAIL_SECONDS);
		const pace = narration > room ? room / narration : 1;
		let index = 0;
		for (const list of perBeat) {
			timed.push(list.map((text) => ({ text, key: wordKey(text), frame: Math.round(((index++ / WORDS_PER_SECOND) * pace) * FPS) })));
		}
	} else {
		// ElevenLabs words come in narration order; beats take them by their own word count.
		let index = 0;
		for (const list of perBeat) {
			timed.push(real.slice(index, index + list.length).map((word) => ({ text: word.text, key: wordKey(word.text), frame: Math.round(word.start * FPS) })));
			index += list.length;
		}
	}

	const starts: number[] = [];
	perBeat.forEach((list, i) => {
		const first = timed[i]?.[0];
		let from = i === 0 ? 0 : first ? first.frame : (starts[i - 1] ?? 0) + Math.round((list.length / WORDS_PER_SECOND) * FPS);
		from = Math.min(last - (perBeat.length - 1 - i), Math.max(from, i === 0 ? 0 : (starts[i - 1] ?? 0) + 1));
		starts.push(Math.max(0, from));
	});
	const beats = starts.map((from, i) => {
		const to = i + 1 < starts.length ? starts[i + 1]! : frames;
		return { from, to, frames: to - from, words: (timed[i] ?? []).map((word) => ({ ...word, frame: Math.min(last, Math.max(from, word.frame)) })) };
	});
	return { estimated, frames, beats };
}

/** Frame of the first occurrence of `word` (first token of a phrase) in the beat; the beat start when absent. */
export function cueFrame(beat: BeatSpan, word: string): number {
	const key = wordKey(tokens(word)[0] ?? '');
	if (!key) return beat.from;
	const hit = beat.words.find((candidate) => candidate.key === key) ?? beat.words.find((candidate) => candidate.key.startsWith(key));
	return hit ? hit.frame : beat.from;
}

/** Frames where preview stills are taken: beat midpoints (at most 5, spread out) and the last frame. */
export function stillFrames(timeline: Timeline): number[] {
	const mids = timeline.beats.map((beat) => Math.floor((beat.from + beat.to) / 2));
	const pick = mids.length <= 5 ? mids : [0, 1, 2, 3, 4].map((i) => mids[Math.round((i * (mids.length - 1)) / 4)]!);
	return [...new Set([...pick, timeline.frames - 1])].sort((a, b) => a - b);
}

/**
 * Layout-only samples (not shown to the Assistant): 6 frames after each beat starts, where a transition can still
 * leave two texts on screen, and the beat's midpoint, so a beat whose two samples are identical stands still.
 */
export function probeFrames(timeline: Timeline): { beat: number; frame: number }[] {
	return timeline.beats.flatMap((beat, i) => {
		const early = Math.min(beat.from + 6, beat.to - 1);
		const mid = Math.floor((beat.from + beat.to) / 2);
		return early === mid ? [{ beat: i, frame: mid }] : [{ beat: i, frame: early }, { beat: i, frame: mid }];
	});
}

/**
 * Preview stills at the times the model chose (seconds), as frames: clamped to the last frame, negatives dropped,
 * duplicates removed, sorted. Without times, the default `stillFrames`.
 */
export function previewFrames(timeline: Timeline, times?: readonly number[]): number[] {
	const last = timeline.frames - 1;
	const frames = (times ?? []).filter((t) => Number.isFinite(t) && t >= 0).map((t) => Math.min(last, Math.round(t * FPS)));
	return frames.length ? [...new Set(frames)].sort((a, b) => a - b) : stillFrames(timeline);
}

/**
 * Most frames rendered for the jump check per preview. Each costs about half a second, and a 16-beat preview with
 * 12 stills already takes ~30 s of the 55 s the preview endpoint allows.
 */
export const MAX_JUMP_PAIRS = 12;

/**
 * The layout samples (`probeFrames`) plus the frame right after each, so a move of one frame can be measured. Past
 * `MAX_JUMP_PAIRS` samples, only an evenly spread subset gets its partner frame.
 */
export function pairedProbes(timeline: Timeline): { beat: number; frame: number }[] {
	const probes = probeFrames(timeline);
	const pick = probes.length <= MAX_JUMP_PAIRS ? probes.map((_, i) => i) : Array.from({ length: MAX_JUMP_PAIRS }, (_, k) => Math.round((k * (probes.length - 1)) / (MAX_JUMP_PAIRS - 1)));
	const paired = new Set(pick);
	const seen = new Set<number>();
	return probes
		.flatMap((probe, i) => [probe, ...(paired.has(i) && probe.frame + 1 < timeline.frames ? [{ beat: probe.beat, frame: probe.frame + 1 }] : [])])
		.filter((probe) => !seen.has(probe.frame) && seen.add(probe.frame));
}

