/**
 * Layout report from the boxes primitives tag (see LayoutProbe). Plain sentences the Assistant can
 * act on, with the time they happen.
 */

import { SAFE } from './kit/areas.ts';
import type { AuditCheck } from './kit/audit.ts';

export type LaidBox = { kind: 'text' | 'mark'; name: string; x: number; y: number; w: number; h: number; size?: number; soft?: boolean };

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

/**
 * `moving`: `kind:name` of boxes that move between this frame and the next; the safe-area rule skips them.
 * `clip`: a silent motion clip (logo reveal, carousel) is designed motion, not a narrated diagram: marks may cross
 * the frame's edges and the frame may be mostly field. Text keeps every rule.
 */
export function layoutIssues(boxes: LaidBox[], frame: { width: number; height: number; seconds: number }, options: { clip?: boolean; moving?: ReadonlySet<string> } = {}): string[] {
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
	// Something in mid-move may cross the margin on its way in or out; only where it rests counts.
	for (const box of (options.clip ? texts : boxes).filter((item) => !options.moving?.has(`${item.kind}:${item.name}`))) {
		const sides = [
			box.x < safe.left ? 'left' : null,
			box.x + box.w > safe.right ? 'right' : null,
			box.y < safe.top ? 'top' : null,
			box.y + box.h > safe.bottom ? 'bottom (the caption zone)' : null,
		].filter(Boolean);
		if (sides.length) issues.push(`${box.kind === 'text' ? 'Text' : 'Mark'} ${quote(box.name)} leaves the safe area on the ${sides.join(' and ')} ${at}.`);
	}

	// Opus's remakes hold every resting state free of filters: a blur left on after the landing is soft text.
	for (const box of texts.filter((item) => item.soft && options.moving && !options.moving.has(`text:${item.name}`))) {
		issues.push(`Text ${quote(box.name)} is still blurred at rest ${at}: clear its blur (or Streak/MotionBlur) once it lands.`);
	}

	const minimum = MIN_TEXT_AT_1080 * (Math.min(width, height) / 1080);
	for (const box of texts) {
		if (box.size !== undefined && box.size < minimum - 0.5) issues.push(`Text ${quote(box.name)} is ${Math.round(box.size)} px, under the ${Math.round(minimum)} px minimum ${at}.`);
	}

	if (options.clip) return issues;
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

/** Text at least this share of the frame's short side (about 96 px at 1080) counts as a beat's picture. */
const BIG_TYPE = 0.09;

/** Marks that are not a picture of the subject on their own. */
const FRAMES_ONLY = new Set(['Board', 'Box']);
/** Marks that move inside their box (canvas fields, a Mark the scene animates), so an unchanged box does not mean a still beat. */
const MOVES_INSIDE = /^(DotField|Spectrogram|Waveform|Shape blob|Mark\b)/;

function signature(boxes: LaidBox[]): string {
	return boxes
		.map((box) => `${box.kind}:${box.name}:${Math.round(box.x / 4)}:${Math.round(box.y / 4)}:${Math.round(box.w / 4)}:${Math.round(box.h / 4)}`)
		.sort()
		.join('|');
}

/**
 * Per-beat issues from the layout samples of each beat (`probeFrames`): a beat with no picture (icon, shape,
 * path, data mark…), and a beat where nothing moves between its two samples.
 */
export function beatIssues(samples: { beat: number; boxes: LaidBox[] | null }[], frame?: { width: number; height: number }): string[] {
	// Display type this big is the picture of a beat (a promise, a number), not a caption.
	const bigType = frame ? BIG_TYPE * Math.min(frame.width, frame.height) : Infinity;
	const byBeat = new Map<number, LaidBox[][]>();
	for (const sample of samples) {
		if (!sample.boxes) continue;
		byBeat.set(sample.beat, [...(byBeat.get(sample.beat) ?? []), sample.boxes]);
	}
	const issues: string[] = [];
	for (const [beat, list] of [...byBeat.entries()].sort((a, b) => a[0] - b[0])) {
		const pictures = list.flat().filter((box) => (box.kind === 'mark' && !FRAMES_ONLY.has(box.name)) || (box.kind === 'text' && (box.size ?? 0) >= bigType));
		if (!pictures.length) issues.push(`Beat ${beat + 1} shows nothing drawn: draw what its narration names (a Mark you draw, a shape, an icon).`);
		else if (list.length > 1 && signature(list[0]!) === signature(list[list.length - 1]!) && !pictures.some((box) => MOVES_INSIDE.test(box.name))) {
			issues.push(`Nothing moves during beat ${beat + 1}: add a change (a swap, a move, a reaction) or an ambient layer.`);
		}
	}
	return issues;
}

/** A size change faster than this per frame (both sides) reads as a lurch, not a zoom. */
const ZOOM_RATE = 1.25;

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
			// A zoom that grows or shrinks both sides by over a quarter in one frame reads as a lurch (Opus's "dive too violent").
			const grow = Math.min(b.w / Math.max(1, a.w), b.h / Math.max(1, a.h));
			const shrink = Math.min(a.w / Math.max(1, b.w), a.h / Math.max(1, b.h));
			const rate = Math.max(grow, shrink);
			if (Math.min(a.w, a.h, b.w, b.h) > 20 && rate > ZOOM_RATE) issues.push(`${quote(a.name)} ${grow >= shrink ? 'grows' : 'shrinks'} ${rate.toFixed(2)}× in one frame at ${pair.seconds.toFixed(1)} s: lengthen or ease the zoom.`);
		}
	}
	return issues;
}


/** `kind:name` of the boxes whose centre moves more than 1 px between two consecutive frames, or that are only in `a`. */
export function movingBoxes(a: LaidBox[], b: LaidBox[]): Set<string> {
	const key = (box: LaidBox) => `${box.kind}:${box.name}`;
	const next = new Map(b.map((box) => [key(box), box]));
	const moving = new Set<string>();
	for (const box of a) {
		const other = next.get(key(box));
		// Absent from the other frame: it is entering or leaving, which is motion too.
		if (!other || Math.hypot(other.x + other.w / 2 - (box.x + box.w / 2), other.y + other.h / 2 - (box.y + box.h / 2)) > 1) moving.add(key(box));
	}
	return moving;
}

/** A box carries the name a check gives, exactly or after its component's prefix ("Mark ball" for "ball"). */
const named = (box: LaidBox, name: string) => box.name === name || box.name.endsWith(` ${name}`);

/** Gap in px between two boxes: negative when they overlap (by the smaller of the two overlaps). */
function gap(a: LaidBox, b: LaidBox): number {
	const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
	const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
	return Math.max(dx, dy);
}

/**
 * The scene's own checks (kit.audit) over every measured frame: one line per failing check, with the worst frame
 * and how many measured frames fail. A check whose boxes are never on screen together passes.
 */
export function auditIssues(checks: AuditCheck[], frames: { seconds: number; boxes: LaidBox[] | null }[]): string[] {
	const issues: string[] = [];
	for (const check of checks) {
		let worst: { seconds: number; value: number } | null = null;
		let failing = 0;
		for (const frame of frames) {
			if (!frame.boxes) continue;
			if (check.kind === 'clear') {
				const as = frame.boxes.filter((box) => named(box, check.a));
				const bs = frame.boxes.filter((box) => named(box, check.b));
				for (const a of as) {
					for (const b of bs) {
						const value = gap(a, b);
						if (value < check.px) {
							failing++;
							if (!worst || value < worst.value) worst = { seconds: frame.seconds, value };
						}
					}
				}
			} else {
				for (const box of frame.boxes.filter((item) => named(item, check.name))) {
					const out = Math.max(check.box.x - box.x, check.box.y - box.y, box.x + box.w - (check.box.x + check.box.w), box.y + box.h - (check.box.y + check.box.h));
					if (out > 2) {
						failing++;
						if (!worst || out > worst.value) worst = { seconds: frame.seconds, value: out };
					}
				}
			}
		}
		if (!worst) continue;
		const when = `at ${worst.seconds.toFixed(1)} s (${failing} measured ${failing === 1 ? 'frame' : 'frames'})`;
		issues.push(
			check.kind === 'clear'
				? `Check clear(${quote(check.a)}, ${quote(check.b)}, ${check.px} px) fails ${when}: ${worst.value < 0 ? `they overlap by ${Math.round(-worst.value)} px` : `only ${Math.round(worst.value)} px apart`}.`
				: `Check inside(${quote(check.name)}, ${check.label}) fails ${when}: ${Math.round(worst.value)} px outside.`,
		);
	}
	return issues;
}
