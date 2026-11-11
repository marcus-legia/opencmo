/**
 * The take against the script (cmo-review-3 I3): which beats of the CMO's script the founder said in the video they
 * uploaded, and which stretches of speech match no beat (false starts, retakes, asides). Pure code over the
 * transcript, no model call, so it costs nothing.
 *
 * Everything here is in SOURCE seconds, the transcript's own clock, because `remove_ranges` cuts in source seconds:
 * the ranges `offScript` returns go to that op as they are. Words already cut from the edit are not read.
 *
 * A retake is the founder saying a beat again because the first try was wrong, so the LAST good take of a beat is the
 * one kept; the earlier ones are off-script and proposed for the cut. Nothing here cuts: the editor shows the ranges
 * and the founder confirms (plan §8, "it never cuts on its own").
 */
import { lcs, splitWords, token } from './script';
import { round, type Range, type Transcript, type Word } from './transcript';

/** A beat matched this well was said: ASR may miss a word or two. */
export const SAID = 0.9;
/** Below SAID but this much of the beat is there: said in part, or said differently. */
export const PARTLY = 0.5;
/** Two off-script words this close are one stretch to cut. */
const JOIN_GAP = 1.0;
/** A stretch shorter than this is a breath, not an aside. */
const MIN_CUT = 0.3;

export type BeatStatus = 'said' | 'partly' | 'missing';

export type BeatTake = {
	/** 0-based, in the script's order. */
	beat: number;
	status: BeatStatus;
	/** Share of the beat's words found in order, 0..1. */
	score: number;
	/** Where the kept take is, in source seconds; absent when the beat is missing. */
	start?: number;
	end?: number;
	/** How many good takes of this beat the video has (2 or more: a retake). */
	takes: number;
};

/** The edit's words in source seconds: inside the clip's window, and not in a range already cut. */
export function sourceWords(transcript: Transcript, window: Range, removed: Range[]): Word[] {
	const cut = (word: Word) => removed.some((range) => word.start >= range.start - 1e-6 && word.end <= range.end + 1e-6);
	return splitWords(transcript.flatMap((segment) => segment.words)).filter(
		(word) => word.start >= window.start - 1e-6 && word.end <= window.end + 1e-6 && !cut(word) && token(word.text),
	);
}

type Hit = { score: number; first: number; last: number };

/** Every place the beat could start, scored by how much of it follows in order there. */
function hits(needle: string[], hay: string[]): Hit[] {
	const span = needle.length + Math.max(2, Math.ceil(needle.length * 0.25));
	const opening = new Set(needle.slice(0, 3));
	const out: Hit[] = [];
	for (let i = 0; i < hay.length; i++) {
		if (!opening.has(hay[i]!)) continue;
		const { length, first, last } = lcs(needle, hay.slice(i, i + span));
		if (length) out.push({ score: length / needle.length, first: i + first, last: i + last });
	}
	return out;
}

/** Under this many words a beat is a short phrase ("Try it now") that also turns up by chance elsewhere in a take. */
const SHORT_BEAT = 4;

/**
 * Each beat's take: said, partly said or missing, and where the kept take is.
 *
 * A long beat keeps its LAST good take: saying it again is a retake. A short beat keeps its FIRST good take after the
 * previous beat's take: a short phrase heard later is more often the same words said in passing than a retake, and
 * keeping the later one would offer the real take for the cut.
 */
export function matchScript(beats: readonly { say: string }[], words: readonly Word[]): BeatTake[] {
	const hay = words.map((word) => token(word.text));
	let after = -Infinity;
	return beats.map((beat, index) => {
		const needle = beat.say.split(/\s+/).map(token).filter(Boolean);
		if (!needle.length) return { beat: index, status: 'missing', score: 0, takes: 0 };
		const all = hits(needle, hay);
		// Good takes that do not overlap: each start inside an earlier take's words is the same take, read again.
		const good: Hit[] = [];
		for (const hit of all.filter((item) => item.score >= SAID)) {
			const previous = good.at(-1);
			if (previous && hit.first <= previous.last) {
				if (hit.score > previous.score) good[good.length - 1] = hit;
			} else good.push(hit);
		}
		const pick = needle.length < SHORT_BEAT ? (good.find((hit) => words[hit.first]!.start >= after) ?? good[0]) : good.at(-1);
		const best = pick ?? all.reduce<Hit | null>((top, hit) => (!top || hit.score > top.score ? hit : top), null);
		if (!best || best.score < PARTLY) return { beat: index, status: 'missing', score: round(best?.score ?? 0), takes: 0 };
		after = words[best.last]!.end;
		return {
			beat: index,
			status: best.score >= SAID ? 'said' : 'partly',
			score: round(best.score),
			start: round(words[best.first]!.start),
			end: round(words[best.last]!.end),
			takes: good.length,
		};
	});
}

/**
 * The stretches of speech that match no kept take, in source seconds, ready for `remove_ranges`.
 *
 * Empty unless EVERY beat was found (said, or said in part) and one was said in full. A beat marked missing is most
 * often a beat the founder said in their own words, and what they said would then be offered for the cut as an
 * aside. The founder still confirms every cut; this keeps the list from proposing their real content.
 */
export function offScript(words: readonly Word[], takes: readonly BeatTake[]): Range[] {
	if (!takes.length || takes.some((take) => take.status === 'missing')) return [];
	const kept = takes.filter((take) => take.start !== undefined && take.end !== undefined) as Required<BeatTake>[];
	if (!kept.some((take) => take.status === 'said')) return [];
	const inKept = (word: Word) => kept.some((take) => word.start >= take.start - 1e-6 && word.end <= take.end + 1e-6);
	const ranges: Range[] = [];
	let open: Range | null = null;
	for (const word of words) {
		if (inKept(word)) {
			if (open) ranges.push(open);
			open = null;
			continue;
		}
		if (open && word.start - open.end <= JOIN_GAP) open.end = word.end;
		else {
			if (open) ranges.push(open);
			open = { start: word.start, end: word.end };
		}
	}
	if (open) ranges.push(open);
	return ranges.filter((range) => range.end - range.start >= MIN_CUT).map((range) => ({ start: round(range.start), end: round(range.end) }));
}
