/** Easing and motion helpers. Power3 out and a critically damped spring; nothing bounces. */

export type Ease = (t: number) => number;

const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

const HERO_W = 9;
const HERO_END = 1 - (1 + HERO_W) * Math.exp(-HERO_W);

export const ease = {
	out: ((t) => 1 - (1 - clamp01(t)) ** 3) as Ease,
	inOut: ((t) => {
		const x = clamp01(t);
		return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
	}) as Ease,
	/** Critically damped spring, normalised to land exactly on 1. */
	hero: ((t) => {
		const x = clamp01(t);
		return (1 - (1 + HERO_W * x) * Math.exp(-HERO_W * x)) / HERO_END;
	}) as Ease,
	linear: ((t) => clamp01(t)) as Ease,
};

export type EnterOptions = { at?: number; dur?: number; ease?: Ease };

/** 0 → 1 progress of something entering at frame `at` over `dur` frames. */
export function enter(frame: number, options: EnterOptions = {}): number {
	const { at = 0, dur = 18, ease: curve = ease.out } = options;
	if (dur <= 0) return frame >= at ? 1 : 0;
	return curve((frame - at) / dur);
}

export type Point = [number, number];

/** Point sets interpolated start-aligned: extra points of the longer set meet the last point of the shorter. */
export function morph(a: Point[], b: Point[], progress: number): Point[] {
	const n = Math.max(a.length, b.length);
	if (n === 0) return [];
	const t = clamp01(progress);
	const out: Point[] = [];
	for (let i = 0; i < n; i++) {
		const p = a[Math.min(i, a.length - 1)] ?? b[i]!;
		const q = b[Math.min(i, b.length - 1)] ?? p;
		out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
	}
	return out;
}

/** Start frame of item `i` in a staggered group. */
export function stagger(i: number, options: { at?: number; each?: number } = {}): number {
	return (options.at ?? 0) + i * (options.each ?? 3);
}

/** mulberry32: the only randomness scenes get, so every render of a job is identical. */
export function random(seed: number): () => number {
	let state = (Math.floor(seed) | 0) ^ 0x9e3779b9;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}
