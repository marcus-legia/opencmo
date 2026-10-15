import React, { createContext, useContext } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { area, type AreaName, type Box } from './areas.ts';
import { enter, ease, type Ease } from './motion.ts';
import { DEFAULT_PERSONALITY, DEFAULT_THEME, type Personality, type Theme } from '../job.ts';
import { MOTION, pop, type MotionStyle } from './personality.ts';
import { alpha, type Palette } from './theme.ts';

export const PaletteContext = createContext<Palette | null>(null);

/**
 * The job's motion personality. `explicit` is false for a job without one (a v1 job): components then keep
 * their v1 timings exactly, and the ambient layer is off by default.
 */
export type MotionSetting = { personality: Personality; style: MotionStyle; explicit: boolean };
export const MotionContext = createContext<MotionSetting>({ personality: DEFAULT_PERSONALITY, style: MOTION[DEFAULT_PERSONALITY], explicit: false });

export const ThemeContext = createContext<Theme>(DEFAULT_THEME);

export function useTheme(): Theme {
	return useContext(ThemeContext);
}

/** The light a mark gives off: a glow on the navy field, a soft drop shadow on paper. */
export function useGlow(): (color: string, strength?: number) => string {
	const theme = useTheme();
	return theme === 'paper'
		? (_color, strength = 1) => `drop-shadow(0 ${3 * strength}px ${8 * strength}px rgba(40, 32, 20, 0.18))`
		: (color, strength = 1) => `drop-shadow(0 0 ${4 * strength}px ${alpha(color, 0.9)}) drop-shadow(0 0 ${14 * strength}px ${alpha(color, 0.45)})`;
}

export function useMotion(): MotionSetting {
	return useContext(MotionContext);
}

/** Thrown for misuse of the kit; the scene boundary forwards the message to the agent. */
export function kitError(message: string): Error {
	return new Error(message.startsWith('kit.') ? message : `kit: ${message}`);
}

export function usePalette(): Palette {
	const palette = useContext(PaletteContext);
	if (!palette) throw kitError('kit components must be rendered inside the scene.');
	return palette;
}

export type ColorProp = string;

export function useColor(value: ColorProp | undefined, fallback: keyof Palette): string {
	const palette = usePalette();
	if (value === undefined) return palette[fallback];
	if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
	if (value in palette) return palette[value as keyof Palette];
	throw kitError(`unknown colour "${value}": use ${Object.keys(palette).join(', ')} or #rrggbb.`);
}

export type AreaProp = AreaName | Box;

export function useArea(value: AreaProp | undefined, fallback: AreaName = 'full'): Box {
	const { width, height } = useVideoConfig();
	const target = value ?? fallback;
	if (typeof target === 'string') {
		if (!['full', 'hero', 'left', 'right', 'top', 'bottom'].includes(target)) throw kitError(`unknown area "${target}": use full, hero, left, right, top or bottom.`);
		return area(target, width, height);
	}
	if (!target || ![target.x, target.y, target.w, target.h].every(Number.isFinite)) throw kitError('an area must be a name or a box from kit.area().');
	return target;
}

export type LifeProps = { at?: number; dur?: number; exitAt?: number; exitDur?: number };

export type Life = {
	frame: number;
	visible: boolean;
	/** Monotone 0 → 1 entrance (opacity, drawing). */
	p: number;
	/** Entrance with the personality's wind-up and overshoot, for scale and position; equals `p` in a v1 job. */
	pop: number;
	out: number;
	opacity: number;
};

/**
 * Shared enter/exit timing for every primitive. Before `at` and after the exit, nothing renders. `base` is the
 * component's v1 entrance length; with a personality it is scaled to the personality's tempo.
 */
export function useLife({ at = 0, dur, exitAt, exitDur }: LifeProps, curve: Ease = ease.out, base = 18, options: { exitEndsAt?: boolean } = {}): Life {
	const frame = useCurrentFrame();
	const motion = useMotion();
	for (const [name, value] of [['at', at], ['dur', dur], ['exitAt', exitAt], ['exitDur', exitDur]] as const) {
		if (value !== undefined && !Number.isFinite(value)) throw kitError(`${name} must be a frame number (got ${String(value)}).`);
	}
	const length = dur ?? (motion.explicit ? Math.max(4, Math.round((base * motion.style.enter) / 18)) : base);
	const exitLength = exitDur ?? (motion.explicit ? motion.style.exit : 15);
	const shape = motion.explicit ? motion.style.curve : curve;
	const p = enter(frame, { at, dur: length, ease: shape });
	const linear = length <= 0 ? (frame >= at ? 1 : 0) : Math.min(1, Math.max(0, (frame - at) / length));
	// Text is gone BY `exitAt`, so the next text can enter at that frame without the two overlapping.
	let out = 0;
	if (exitAt !== undefined) {
		const start = options.exitEndsAt ? Math.max(at + 1, exitAt - exitLength) : exitAt;
		out = enter(frame, { at: start, dur: options.exitEndsAt ? Math.max(1, exitAt - start) : exitLength, ease: ease.inOut });
	}
	const visible = frame >= at && out < 1;
	return { frame, visible, p, pop: motion.explicit ? pop(linear, motion.style) : p, out, opacity: p * (1 - out) };
}

export function TextTag({ name, size, style, children }: { name: string; size: number; style: React.CSSProperties; children: React.ReactNode }) {
	return (
		<div data-box="text" data-name={name} data-size={size} style={style}>
			{children}
		</div>
	);
}

export function MarkTag({ name, target }: { name: string; target: Box }) {
	return <div data-box="mark" data-name={name} style={{ position: 'absolute', left: target.x, top: target.y, width: target.w, height: target.h, pointerEvents: 'none' }} />;
}
