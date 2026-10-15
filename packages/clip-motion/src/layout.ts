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
