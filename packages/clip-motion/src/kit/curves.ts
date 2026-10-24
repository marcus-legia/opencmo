/**
 * Named curves and small motion helpers for free-form scenes (kit.curves, kit.tween, kit.noise, kit.drawOn,
 * kit.speedBlur). The kit's own components keep their personality timings; these are for motion the scene writes itself.
 */

import { Easing } from 'remotion';

import type { Ease } from './motion.ts';

/** CSS-style cubic-bezier curves. `back` overshoots about 3% and settles; `anticipate` dips about 5% first. */
export const curves = Object.freeze({
	linear: ((t: number) => t) as Ease,
	smooth: Easing.bezier(0.65, 0, 0.35, 1) as Ease,
	out: Easing.bezier(0.16, 1, 0.3, 1) as Ease,
	soft: Easing.bezier(0.33, 1, 0.68, 1) as Ease,
	in: Easing.bezier(0.55, 0, 1, 0.45) as Ease,
	snap: Easing.bezier(0.85, 0, 0.15, 1) as Ease,
	back: Easing.bezier(0.34, 1.22, 0.64, 1) as Ease,
	anticipate: Easing.bezier(0.38, -0.28, 0.42, 1) as Ease,
});

export type CurveName = keyof typeof curves;

/**
 * `from` → `to` between frames `f0` and `f1` on a curve (a name or a function), held before and after.
 * Numbers or same-length number arrays (a point, a colour channel list).
 */
export function tween<T extends number | number[]>(frame: number, frames: [number, number], values: [T, T], curve: CurveName | Ease = 'out'): T {
	const [f0, f1] = frames;
	if (!Number.isFinite(f0) || !Number.isFinite(f1)) throw new Error('kit.tween: frames must be numbers.');
	const shape = typeof curve === 'function' ? curve : curves[curve];
	if (!shape) throw new Error(`kit.tween: unknown curve "${String(curve)}": use ${Object.keys(curves).join(', ')}.`);
	const raw = f1 <= f0 ? (frame >= f1 ? 1 : 0) : Math.min(1, Math.max(0, (frame - f0) / (f1 - f0)));
	const t = shape(raw);
	const [a, b] = values;
	if (typeof a === 'number' && typeof b === 'number') return (a + (b - a) * t) as T;
	if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) return a.map((value, i) => value + (b[i]! - value) * t) as T;
	throw new Error('kit.tween: values are two numbers or two arrays of the same length.');
}

function hash(seed: number, x: number, y: number): number {
	let h = (seed * 374761393 + x * 668265263 + y * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return ((h >>> 0) / 4294967295) * 2 - 1;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/**
 * Smooth deterministic value noise in [-1, 1]: `kit.noise(seed)(x)` or `(x, y)`. Drive it with time
 * (`frame / 60`) for drift, sway and organic wobble that is the same on every render.
 */
export function noise(seed = 0): (x: number, y?: number) => number {
	return (x: number, y = 0) => {
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const tx = fade(x - x0);
		const ty = fade(y - y0);
		const top = hash(seed, x0, y0) + (hash(seed, x0 + 1, y0) - hash(seed, x0, y0)) * tx;
		const bottom = hash(seed, x0, y0 + 1) + (hash(seed, x0 + 1, y0 + 1) - hash(seed, x0, y0 + 1)) * tx;
		return top + (bottom - top) * ty;
	};
}

/** SVG stroke props that draw a path on from 0 to 1: spread them on a <path>, <circle> or <line>. */
export function drawOn(progress: number): { pathLength: number; strokeDasharray: number; strokeDashoffset: number } {
	const p = Math.min(1, Math.max(0, progress));
	return { pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - p };
}

/**
 * Blur in px for something moving `speed` px per frame: zero at rest, so resting text and edges stay crisp.
 * Use as `filter: blur(${kit.speedBlur(speed)}px)`.
 */
export function speedBlur(speed: number, options: { k?: number; max?: number } = {}): number {
	const { k = 0.06, max = 6 } = options;
	const blur = Math.min(max, Math.abs(speed) * k);
	return blur < 0.15 ? 0 : Math.round(blur * 100) / 100;
}
