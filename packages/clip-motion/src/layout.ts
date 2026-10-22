/**
 * Layout report from the boxes primitives tag (see LayoutProbe). Plain sentences the Assistant can
 * act on, with the time they happen.
 */

import { SAFE } from './kit/areas.ts';

export type LaidBox = { kind: 'text' | 'mark'; name: string; x: number; y: number; w: number; h: number; size?: number };

const MIN_TEXT_AT_1080 = 36;
const EMPTY_LIMIT = 0.85;
const GRID = 48;

function overlap(a: LaidBox, b: LaidBox): number {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
	return w > 0 && h > 0 ? w * h : 0;
}

function quote(name: string): string {
	return name.length > 40 ? `"${name.slice(0, 37)}…"` : `"${name}"`;
}

export function layoutIssues(boxes: LaidBox[], frame: { width: number; height: number; seconds: number }): string[] {
	const { width, height } = frame;
	const at = `at ${frame.seconds.toFixed(1)} s`;
	const issues: string[] = [];
	const texts = boxes.filter((box) => box.kind === 'text');

	for (let i = 0; i < texts.length; i++) {
		for (let j = i + 1; j < texts.length; j++) {
			const a = texts[i]!;
			const b = texts[j]!;
			const shared = overlap(a, b);
			if (shared > 0.1 * Math.min(a.w * a.h, b.w * b.h)) issues.push(`Text ${quote(a.name)} overlaps text ${quote(b.name)} ${at}.`);
		}
	}

	const tolerance = 2;
	const safe = { left: width * SAFE.left - tolerance, right: width * SAFE.right + tolerance, top: height * SAFE.top - tolerance, bottom: height * SAFE.bottom + tolerance };
	for (const box of boxes) {
		const sides = [
			box.x < safe.left ? 'left' : null,
			box.x + box.w > safe.right ? 'right' : null,
			box.y < safe.top ? 'top' : null,
			box.y + box.h > safe.bottom ? 'bottom (the caption zone)' : null,
		].filter(Boolean);
		if (sides.length) issues.push(`${box.kind === 'text' ? 'Text' : 'Mark'} ${quote(box.name)} leaves the safe area on the ${sides.join(' and ')} ${at}.`);
	}

	const minimum = MIN_TEXT_AT_1080 * (Math.min(width, height) / 1080);
	for (const box of texts) {
		if (box.size !== undefined && box.size < minimum - 0.5) issues.push(`Text ${quote(box.name)} is ${Math.round(box.size)} px, under the ${Math.round(minimum)} px minimum ${at}.`);
	}

	// Coverage of the safe area by anything tagged, on a coarse grid.
	const cellW = (safe.right - safe.left) / GRID;
	const cellH = (safe.bottom - safe.top) / GRID;
	let covered = 0;
	for (let gx = 0; gx < GRID; gx++) {
		for (let gy = 0; gy < GRID; gy++) {
			const cx = safe.left + (gx + 0.5) * cellW;
			const cy = safe.top + (gy + 0.5) * cellH;
			if (boxes.some((box) => cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h)) covered++;
		}
	}
	if (covered / (GRID * GRID) < 1 - EMPTY_LIMIT) issues.push(`The frame is more than ${Math.round(EMPTY_LIMIT * 100)}% empty ${at}: grow or add the visual.`);
	return issues;
}

/** Marks that are not a picture of the subject on their own. */
const FRAMES_ONLY = new Set(['Board', 'Box']);
/** Marks that move inside their box (canvas fields, Lottie), so an unchanged box does not mean a still beat. */
const MOVES_INSIDE = /^(DotField|Spectrogram|Waveform|Lottie\b|Shape blob)/;

function signature(boxes: LaidBox[]): string {
	return boxes
		.map((box) => `${box.kind}:${box.name}:${Math.round(box.x / 4)}:${Math.round(box.y / 4)}:${Math.round(box.w / 4)}:${Math.round(box.h / 4)}`)
		.sort()
		.join('|');
}

/**
 * Per-beat issues from the layout samples of each beat (`probeFrames`): a beat with no picture (icon, shape,
 * Lottie, path, data mark…), and a beat where nothing moves between its two samples.
 */
export function beatIssues(samples: { beat: number; boxes: LaidBox[] | null }[]): string[] {
	const byBeat = new Map<number, LaidBox[][]>();
	for (const sample of samples) {
		if (!sample.boxes) continue;
		byBeat.set(sample.beat, [...(byBeat.get(sample.beat) ?? []), sample.boxes]);
	}
	const issues: string[] = [];
	for (const [beat, list] of [...byBeat.entries()].sort((a, b) => a[0] - b[0])) {
		const pictures = list.flat().filter((box) => box.kind === 'mark' && !FRAMES_ONLY.has(box.name));
		if (!pictures.length) issues.push(`Beat ${beat + 1} shows no icon, shape or Lottie: draw what its narration names.`);
		else if (list.length > 1 && signature(list[0]!) === signature(list[list.length - 1]!) && !pictures.some((box) => MOVES_INSIDE.test(box.name))) {
			issues.push(`Nothing moves during beat ${beat + 1}: add a change (a swap, a move, a reaction) or an ambient layer.`);
		}
	}
	return issues;
}

/** A move of more than this share of the frame's short side between two frames (1/30 s) reads as a jump. */
const JUMP_SHARE = 0.12;

/**
 * Marks and texts that leap between two consecutive frames: the same `kind` + `name` (only when it is unique in both
 * frames, so two icons of one name are never confused), centre moved more than 12% of the short side. A box that
 * appears or disappears is a cut, not a jump.
 */
export function jumpIssues(pairs: { seconds: number; a: LaidBox[]; b: LaidBox[] }[], frame: { width: number; height: number }): string[] {
	const limit = JUMP_SHARE * Math.min(frame.width, frame.height);
	const key = (box: LaidBox) => `${box.kind}:${box.name}`;
	const unique = (boxes: LaidBox[]) => {
		const counts = new Map<string, number>();
		for (const box of boxes) counts.set(key(box), (counts.get(key(box)) ?? 0) + 1);
		return new Map(boxes.filter((box) => counts.get(key(box)) === 1).map((box) => [key(box), box]));
	};
	const issues: string[] = [];
	for (const pair of pairs) {
		const after = unique(pair.b);
		for (const [name, a] of unique(pair.a)) {
			const b = after.get(name);
			if (!b) continue;
			const moved = Math.hypot(b.x + b.w / 2 - (a.x + a.w / 2), b.y + b.h / 2 - (a.y + a.h / 2));
			if (moved > limit) issues.push(`${quote(a.name)} jumps ${Math.round(moved)} px in one frame at ${pair.seconds.toFixed(1)} s: ease the move or cut on purpose.`);
		}
	}
	return issues;
}

