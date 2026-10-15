import React, { createContext, useContext } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { area, type AreaName, type Box } from './areas.ts';
import { enter, ease, type Ease } from './motion.ts';
import type { Palette } from './theme.ts';

export const PaletteContext = createContext<Palette | null>(null);

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

export type Life = { frame: number; visible: boolean; p: number; out: number; opacity: number };

/** Shared enter/exit timing for every primitive. Before `at` and after the exit, nothing renders. */
export function useLife({ at = 0, dur = 18, exitAt, exitDur = 15 }: LifeProps, curve: Ease = ease.out): Life {
	const frame = useCurrentFrame();
	for (const [name, value] of [['at', at], ['dur', dur], ['exitAt', exitAt], ['exitDur', exitDur]] as const) {
		if (value !== undefined && !Number.isFinite(value)) throw kitError(`${name} must be a frame number (got ${String(value)}).`);
	}
	const p = enter(frame, { at, dur, ease: curve });
	const out = exitAt === undefined ? 0 : enter(frame, { at: exitAt, dur: exitDur, ease: ease.inOut });
	const visible = frame >= at && out < 1;
	return { frame, visible, p, out, opacity: p * (1 - out) };
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
