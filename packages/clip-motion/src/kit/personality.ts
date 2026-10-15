/**
 * Motion personalities for explainers. Same four names as `PERSONALITY` in
 * packages/editor-core/src/motion/intro.ts, which adapts the LottieFiles motion-design skill (MIT, see
 * THIRD_PARTY_NOTICES.md) to video intros. An explainer beat lasts about 4 s, so entrances here are a little
 * shorter than an intro's and every number is in frames (30 fps).
 *
 * - `enter` / `exit`: default entrance and exit length.
 * - `overshoot`: how far a scale or position passes its target before settling (0 = none).
 * - `anticipation`: how far it first moves the other way (a wind-up), as a fraction of the travel.
 * - `stagger`: frames between items entering in a group.
 * - `follow`: frames a secondary layer (glow, halo) lags behind its primary mark.
 */

import { ease, type Ease } from './motion.ts';
import type { Personality } from '../job.ts';

export type MotionStyle = {
	enter: number;
	exit: number;
	overshoot: number;
	anticipation: number;
	stagger: number;
	follow: number;
	/** Monotone 0 → 1 curve for opacity, stroke drawing and anything that must not pass 1. */
	curve: Ease;
};

const cubic = (x1: number, y1: number, x2: number, y2: number): Ease => {
	// Newton iterations on the x polynomial, then y: CSS cubic-bezier.
	const at = (a1: number, a2: number, t: number) => 3 * a1 * t * (1 - t) ** 2 + 3 * a2 * t ** 2 * (1 - t) + t ** 3;
	return (input) => {
		const x = input <= 0 ? 0 : input >= 1 ? 1 : input;
		let t = x;
		for (let i = 0; i < 6; i++) {
			const dx = at(x1, x2, t) - x;
			const slope = 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t ** 2;
			if (Math.abs(slope) < 1e-6) break;
			t = Math.min(1, Math.max(0, t - dx / slope));
		}
		return at(y1, y2, t);
	};
};

export const MOTION: Record<Personality, MotionStyle> = {
	premium: { enter: 22, exit: 15, overshoot: 0, anticipation: 0, stagger: 5, follow: 5, curve: cubic(0.4, 0, 0.2, 1) },
	corporate: { enter: 16, exit: 11, overshoot: 0.03, anticipation: 0.02, stagger: 4, follow: 4, curve: cubic(0.2, 0, 0, 1) },
	playful: { enter: 15, exit: 10, overshoot: 0.14, anticipation: 0.06, stagger: 5, follow: 4, curve: ease.out },
	energetic: { enter: 10, exit: 7, overshoot: 0.2, anticipation: 0.04, stagger: 2, follow: 3, curve: cubic(0.16, 1, 0.3, 1) },
};

/**
 * Entrance with a wind-up and an overshoot: starts by moving `anticipation` the wrong way (first 18%),
 * passes 1 by `overshoot`, then settles exactly on 1. For scale and position, never for opacity.
 */
export function pop(t: number, style: Pick<MotionStyle, 'overshoot' | 'anticipation' | 'curve'>): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	const windUp = style.anticipation > 0 ? 0.18 : 0;
	if (t < windUp) return -style.anticipation * Math.sin((t / windUp) * Math.PI);
	const u = windUp ? (t - windUp) / (1 - windUp) : t;
	if (style.overshoot <= 0) return style.curve(u);
	// Back-out; its peak passes 1 by about overshoot for s = 17 × overshoot (s = 1.70158 gives 10%).
	const s = style.overshoot * 17;
	const v = u - 1;
	return 1 + (s + 1) * v ** 3 + s * v ** 2;
}

/** A damped wobble 0 → peak → 0 after `at`, for reactions and settles (frames). */
export function wobble(frame: number, at: number, { length = 24, cycles = 1.5 } = {}): number {
	if (frame < at) return 0;
	const t = (frame - at) / length;
	if (t >= 1) return 0;
	return Math.sin(t * Math.PI * 2 * cycles) * (1 - t) ** 2;
}
