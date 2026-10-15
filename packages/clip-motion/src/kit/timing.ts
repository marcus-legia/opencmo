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

export function buildTimeline(job: Pick<MotionJob, 'beats' | 'duration' | 'words'>): Timeline {
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
