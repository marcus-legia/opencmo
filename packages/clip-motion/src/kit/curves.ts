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
	// Curves named by intent, after the launch films of opus-pro/opusclip-video-tools (templates/agent-opus, MIT,
	// Copyright (c) 2026 OpusClip): pick by what the motion does, not by how it looks.
	/** Something landing: a fast start and a long brake into rest. */
	arrive: Easing.bezier(0.22, 1, 0.36, 1) as Ease,
	/** Travel between two resting places: slow out, fast middle, slow in. */
	glide: Easing.bezier(0.76, 0, 0.24, 1) as Ease,
	/** Something leaving: it accelerates away and never brakes. */
	leave: Easing.bezier(0.4, 0, 1, 1) as Ease,
	/** A container growing to its new size (a pill into a card). */
	expand: Easing.bezier(0.7, 0, 0.2, 1) as Ease,
	/** A stream of letters or items that eases in and thins out. */
	stream: Easing.bezier(0.22, 0.06, 0.62, 1) as Ease,
	/** One camera move between two holds: brief acceleration, fast travel, short braking, zero velocity at both ends. */
	impulse: Easing.bezier(0.62, 0, 0.18, 1) as Ease,
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

// travel and snap are ported from opus-pro/opusclip-video-tools remakes/opus-5.5/pf-type-snap/project/src/easing.ts
// (MIT, Copyright (c) 2026 OpusClip; see THIRD_PARTY_NOTICES.md).

/** Peaks by curve: `travel` runs per element per frame, and a curve's peak never changes. */
const peaks = new WeakMap<Ease, { p: number; u: number }>();

function peakOf(curve: Ease, samples = 2000): { p: number; u: number } {
	const known = peaks.get(curve);
	if (known) return known;
	let p = -Infinity;
	let u = 0;
	for (let i = 0; i <= samples; i++) {
		const v = curve(i / samples);
		if (v > p) {
			p = v;
			u = i / samples;
		}
	}
	const peak = { p, u };
	peaks.set(curve, peak);
	return peak;
}

/**
 * Offset in px from rest for something travelling `distance` px on `curve`, with the overshoot past rest capped at
 * `overshoot` px: `u` is 0..1 progress. Velocity stays continuous through rest and it settles with zero velocity.
 * Use as translateX(kit.travel(u, 1400, { overshoot: 24 })) for an entrance from the right.
 */
export function travel(u: number, distance: number, options: { curve?: CurveName | Ease; overshoot?: number } = {}): number {
	const shape = typeof options.curve === 'function' ? options.curve : curves[options.curve ?? 'back'];
	const max = Math.max(0.0001, options.overshoot ?? 24);
	const peak = peakOf(shape);
	const clamped = Math.min(1, Math.max(0, u));
	const p = shape(clamped);
	if (p <= 1 || peak.p <= 1) return distance * (1 - Math.min(1, p));
	const excess = Math.max(1e-9, peak.p - 1);
	const e = p - 1;
	if (clamped < peak.u) return -max * Math.tanh((distance * e) / max);
	const peakPx = max * Math.tanh((distance * excess) / max);
	return -peakPx * (e / excess) * (e / excess);
}

/** A two-phase snap: ease to 1 + overshoot by `split`, then a cosine settle back to exactly 1. */
export function snap(u: number, options: { overshoot?: number; split?: number; curve?: CurveName | Ease } = {}): number {
	const { overshoot = 0.02, split = 0.8 } = options;
	const shape = typeof options.curve === 'function' ? options.curve : curves[options.curve ?? 'smooth'];
	if (u <= 0) return 0;
	if (u >= 1) return 1;
	if (u < split) return (1 + overshoot) * shape(u / split);
	return 1 + overshoot * 0.5 * (1 + Math.cos((Math.PI * (u - split)) / (1 - split)));
}

/**
 * Motion smear for something moving `speed` px per frame along one axis, `size` px long on that axis: a directional
 * blur and a stretch of a fixed pixel length (like a shutter streak). Zero at rest. Feed it to kit.Streak.
 */
export function smear(speed: number, size: number): { blur: number; stretch: number } {
	const v = Math.abs(speed);
	const blur = Math.min(28, v * 0.22);
	const px = Math.min(84, v * 0.85);
	return { blur: blur < 0.35 ? 0 : Math.round(blur * 100) / 100, stretch: px < 0.6 ? 1 : 1 + px / Math.max(1, size) };
}

// retime, shots and poseBlur are ported from opus-pro/opusclip-video-tools templates/agent-opus/project/src/agent-opus/
// code-ui/motion.ts (MIT, Copyright (c) 2026 OpusClip; see THIRD_PARTY_NOTICES.md).

export type Retime = {
	/** The scene frame to draw at output frame `frame` (pass it to the scene's clock). */
	source: (frame: number) => number;
	/** The output frame where scene frame `frame` now lands. */
	output: (frame: number) => number;
};

/**
 * A time warp through `knots` of `[outputFrame, sceneFrame]`, both increasing: a monotone cubic, so speed changes
 * smoothly through every knot and never jumps. Tighten or stretch a scene while every approved landing stays on its
 * knot. Outside the knots it continues 1:1.
 */
export function retime(knots: [number, number][]): Retime {
	if (!Array.isArray(knots) || knots.length < 2) throw new Error('kit.retime needs at least two [outputFrame, sceneFrame] knots.');
	const x = knots.map((k) => k[0]);
	const y = knots.map((k) => k[1]);
	for (let i = 1; i < knots.length; i++) {
		if (!(x[i]! > x[i - 1]!) || !(y[i]! > y[i - 1]!)) throw new Error('kit.retime: knots must increase in both output and scene frames.');
	}
	const h = x.slice(1).map((v, i) => v - x[i]!);
	const d = y.slice(1).map((v, i) => (v - y[i]!) / h[i]!);
	const tangent = x.map((_, i) => {
		if (i === 0) return d[0]!;
		if (i === x.length - 1) return d[d.length - 1]!;
		if (d[i - 1]! * d[i]! <= 0) return 0;
		const a = 2 * h[i]! + h[i - 1]!;
		const b = h[i]! + 2 * h[i - 1]!;
		return (a + b) / (a / d[i - 1]! + b / d[i]!);
	});
	const last = x.length - 1;
	const source = (f: number) => {
		if (f <= x[0]!) return y[0]! + (f - x[0]!);
		if (f >= x[last]!) return y[last]! + (f - x[last]!);
		let i = 0;
		while (x[i + 1]! < f) i++;
		const u = (f - x[i]!) / h[i]!;
		return (2 * u ** 3 - 3 * u * u + 1) * y[i]! + (u ** 3 - 2 * u * u + u) * h[i]! * tangent[i]! + (-2 * u ** 3 + 3 * u * u) * y[i + 1]! + (u ** 3 - u * u) * h[i]! * tangent[i + 1]!;
	};
	const output = (f: number) => {
		if (f <= y[0]!) return x[0]! + (f - y[0]!);
		if (f >= y[last]!) return x[last]! + (f - y[last]!);
		let lo = x[0]!;
		let hi = x[last]!;
		for (let i = 0; i < 48; i++) {
			const mid = (lo + hi) / 2;
			if (source(mid) < f) lo = mid;
			else hi = mid;
		}
		return (lo + hi) / 2;
	};
	return { source, output };
}

export type Pose = { scale: number; x: number; y: number };
export type ShotMove = { from: number; to: number; pose: Partial<Pose>; curve?: CurveName | Ease };

/**
 * A camera as a list of moves: each move goes from the previous pose to `pose` between frames `from` and `to` on
 * `impulse` (or its own curve), and the camera holds between moves. `x`/`y` are px offsets, `scale` zooms about the
 * frame centre. Returns the pose at a frame.
 */
export function shots(moves: ShotMove[], start: Partial<Pose> = {}): (frame: number) => Pose {
	if (!Array.isArray(moves)) throw new Error('kit.shots needs a list of { from, to, pose } moves.');
	const list = [...moves].sort((a, b) => a.from - b.from);
	for (const move of list) {
		if (!Number.isFinite(move.from) || !Number.isFinite(move.to) || move.to < move.from) throw new Error('kit.shots: every move needs from <= to (frames).');
		if (move.pose.scale !== undefined && !(move.pose.scale >= 0.2 && move.pose.scale <= 6)) throw new Error('kit.shots: scale must be between 0.2 and 6.');
	}
	const first: Pose = { scale: start.scale ?? 1, x: start.x ?? 0, y: start.y ?? 0 };
	return (frame: number) => {
		let pose = first;
		for (const move of list) {
			if (frame < move.from) break;
			const goal: Pose = { scale: move.pose.scale ?? pose.scale, x: move.pose.x ?? pose.x, y: move.pose.y ?? pose.y };
			const shape = typeof move.curve === 'function' ? move.curve : curves[move.curve ?? 'impulse'];
			const t = move.to === move.from ? 1 : shape(Math.min(1, (frame - move.from) / (move.to - move.from)));
			if (frame <= move.to) return { scale: pose.scale + (goal.scale - pose.scale) * t, x: pose.x + (goal.x - pose.x) * t, y: pose.y + (goal.y - pose.y) * t };
			pose = goal;
		}
		return pose;
	};
}

/**
 * Directional blur in px for a camera moving from pose `prev` to `next` in one frame: a zoom counts as travel, both
 * axes are capped, and it is zero at rest so resting frames are crisp.
 */
export function poseBlur(prev: Pose, next: Pose, options: { k?: number; max?: [number, number] } = {}): { x: number; y: number } {
	const { k = 0.13, max = [16, 12] } = options;
	const zoom = Math.abs(next.scale - prev.scale) * 850;
	const x = Math.min(max[0], (Math.abs(next.x - prev.x) + zoom) * k);
	const y = Math.min(max[1], (Math.abs(next.y - prev.y) + zoom) * k);
	return { x: x < 0.15 ? 0 : Math.round(x * 100) / 100, y: y < 0.15 ? 0 : Math.round(y * 100) / 100 };
}

export type Phase = [from: number, to: number, curve?: CurveName | Ease];

/**
 * Named progress values from one clock (learned from agent-opus `OutputHandoff.ts`, MIT): a scene change is several
 * parts moving on staggered windows of one frame count — the old cards retire first, the background dissolves, the
 * new prompt arrives last — not one fade. Each name gets its eased 0..1 at `frame`.
 */
export function phases<T extends Record<string, Phase>>(frame: number, spec: T): { [K in keyof T]: number } {
	if (!spec || typeof spec !== 'object') throw new Error('kit.phases needs { name: [fromFrame, toFrame, curve?] }.');
	const out = {} as { [K in keyof T]: number };
	for (const [name, phase] of Object.entries(spec) as [keyof T & string, Phase][]) {
		if (!Array.isArray(phase) || !Number.isFinite(phase[0]) || !Number.isFinite(phase[1])) throw new Error(`kit.phases: "${name}" needs [fromFrame, toFrame, curve?].`);
		out[name as keyof T] = tween(frame, [phase[0], phase[1]], [0, 1], phase[2] ?? 'glide');
	}
	return out;
}

export type HandoffBox = { x: number; y: number; w: number; h: number };

/**
 * One rectangle carried from scene A's layout to scene B's (agent-opus: "the outgoing panel and the incoming prompt
 * follow the same rectangle"): draw A's content and B's content in the box it returns, crossfading on `p`, and the
 * eye follows one object through the cut. Held at A before `frames[0]` and at B after `frames[1]`.
 */
export function handoff(frame: number, frames: [number, number], from: HandoffBox, to: HandoffBox, curve: CurveName | Ease = 'glide'): HandoffBox & { p: number } {
	for (const box of [from, to]) {
		if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) throw new Error('kit.handoff: boxes are { x, y, w, h } in px.');
	}
	const p = tween(frame, frames, [0, 1], curve);
	const mix = (a: number, b: number) => a + (b - a) * p;
	return { x: mix(from.x, to.x), y: mix(from.y, to.y), w: mix(from.w, to.w), h: mix(from.h, to.h), p };
}
