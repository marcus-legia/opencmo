/**
 * Finding the words a proof card zooms to on a captured page (`page.boxes.json`, Track C).
 *
 * The capture stores one run per word, in reading order, with its rectangle in CSS pixels of the
 * page. The Assistant writes `focus` from what it read on the page, so the match forgives case,
 * spacing and the punctuation around words ("skills," still matches "skills"), never the words
 * themselves: a focus that is not on the page is an error that names the closest text, so the
 * next try quotes what is really there.
 */

export type CaptureRun = { text: string; rect: [number, number, number, number] };

export type FocusHit = {
	/** Index of the first and one past the last run of the match. */
	from: number;
	to: number;
	/** Bounding box of the matched runs on their first line, in CSS pixels of the page. */
	rect: { x: number; y: number; width: number; height: number };
};

const EDGE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/** A word as compared: NFKC, lower case, without punctuation at its edges (kept when that is all it is). */
export function foldWord(word: string): string {
	const folded = word.normalize('NFKC').toLowerCase();
	const trimmed = folded.replace(EDGE, '');
	return trimmed || folded;
}

export const focusWords = (focus: string): string[] => focus.split(/\s+/).filter(Boolean).map(foldWord);

/** The first place the focus words appear as consecutive runs; null when they do not. */
export function findFocus(runs: readonly CaptureRun[], focus: string): FocusHit | null {
	const words = focusWords(focus);
	if (!words.length) return null;
	const folded = runs.map((run) => foldWord(run.text));
	for (let from = 0; from + words.length <= runs.length; from++) {
		if (!words.every((word, index) => folded[from + index] === word)) continue;
		return { from, to: from + words.length, rect: lineBox(runs.slice(from, from + words.length)) };
	}
	return null;
}

/**
 * The box to mark: the runs on the first line of the match. A phrase that wraps would otherwise
 * mark the whole paragraph between its two halves.
 */
function lineBox(runs: readonly CaptureRun[]): FocusHit['rect'] {
	const first = runs[0]!.rect;
	const line = runs.filter((run) => Math.abs(run.rect[1] - first[1]) <= first[3] * 0.5);
	const x0 = Math.min(...line.map((run) => run.rect[0]));
	const y0 = Math.min(...line.map((run) => run.rect[1]));
	const x1 = Math.max(...line.map((run) => run.rect[0] + run.rect[2]));
	const y1 = Math.max(...line.map((run) => run.rect[1] + run.rect[3]));
	return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Similarity of two strings by shared letter pairs (Dice), 0–1. */
function similarity(a: string, b: string): number {
	const pairs = (text: string) => {
		const out = new Map<string, number>();
		for (let index = 0; index < text.length - 1; index++) {
			const pair = text.slice(index, index + 2);
			out.set(pair, (out.get(pair) ?? 0) + 1);
		}
		return out;
	};
	if (a === b) return 1;
	if (a.length < 2 || b.length < 2) return 0;
	const left = pairs(a);
	const right = pairs(b);
	let shared = 0;
	for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0);
	return (2 * shared) / (a.length - 1 + b.length - 1);
}

/** The run text most like the focus, as many words long, for the error message. */
export function closestText(runs: readonly CaptureRun[], focus: string): string | null {
	const size = Math.max(1, focusWords(focus).length);
	const target = focusWords(focus).join(' ');
	let best: { text: string; score: number } | null = null;
	for (let from = 0; from + size <= runs.length; from++) {
		const window = runs.slice(from, from + size);
		const score = similarity(target, window.map((run) => foldWord(run.text)).join(' '));
		if (!best || score > best.score) best = { text: window.map((run) => run.text).join(' '), score };
	}
	return best && best.score > 0.2 ? best.text : null;
}
