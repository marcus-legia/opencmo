import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

import { kitError, usePalette } from './context.tsx';
import { ease, enter } from './motion.ts';
import { alpha } from './theme.ts';

export type StageProps = { children?: React.ReactNode; grid?: boolean };

/** The navy field every scene sits on: gradient, slow-drifting grid, soft bloom, vignette. */
export function Stage({ children, grid = true }: StageProps) {
	const palette = usePalette();
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const cell = Math.round(Math.min(width, height) / 12);
	const drift = (frame * 0.15) % cell;
	return (
		<AbsoluteFill style={{ background: `radial-gradient(ellipse 85% 75% at 50% 42%, #142A52 0%, ${palette.field} 55%, #050A16 100%)`, overflow: 'hidden' }}>
			{grid ? (
				<AbsoluteFill
					style={{
						backgroundImage: `linear-gradient(${alpha('#8FB0F0', 0.07)} 1px, transparent 1px), linear-gradient(90deg, ${alpha('#8FB0F0', 0.07)} 1px, transparent 1px)`,
						backgroundSize: `${cell}px ${cell}px`,
						backgroundPosition: `${drift}px ${drift * 0.6}px`,
						maskImage: 'radial-gradient(ellipse 70% 65% at 50% 45%, black 30%, transparent 100%)',
					}}
				/>
			) : null}
			<AbsoluteFill style={{ background: `radial-gradient(circle at 50% 45%, ${alpha(palette.signal, 0.05)} 0%, transparent 45%)` }} />
			<AbsoluteFill>{children}</AbsoluteFill>
			<AbsoluteFill style={{ background: 'radial-gradient(ellipse 120% 100% at 50% 45%, transparent 55%, rgba(2,5,12,0.55) 100%)', pointerEvents: 'none' }} />
		</AbsoluteFill>
	);
}

export type CameraKey = { at: number; focus?: [number, number]; zoom?: number; dur?: number };
export type CameraProps = { children?: React.ReactNode; keys?: CameraKey[]; focus?: [number, number]; zoom?: number; at?: number; dur?: number };

/** Slow push-ins and pans over everything inside. Each key eases from the previous framing. */
export function Camera({ children, keys, focus, zoom, at, dur }: CameraProps) {
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const list: CameraKey[] = keys ?? (focus || zoom ? [{ at: at ?? 0, focus, zoom, dur }] : []);
	let state = { x: width / 2, y: height / 2, zoom: 1 };
	for (const key of [...list].sort((a, b) => a.at - b.at)) {
		if (!Number.isFinite(key.at)) throw kitError('Camera keys need `at` frames.');
		if (key.zoom !== undefined && !(key.zoom >= 0.5 && key.zoom <= 4)) throw kitError('Camera zoom must be between 0.5 and 4.');
		const t = enter(frame, { at: key.at, dur: key.dur ?? 45, ease: ease.hero });
		if (t <= 0) break;
		const goal = { x: key.focus?.[0] ?? state.x, y: key.focus?.[1] ?? state.y, zoom: key.zoom ?? state.zoom };
		state = { x: state.x + (goal.x - state.x) * t, y: state.y + (goal.y - state.y) * t, zoom: state.zoom + (goal.zoom - state.zoom) * t };
	}
	return (
		<AbsoluteFill style={{ transformOrigin: '0 0', transform: `translate(${width / 2}px, ${height / 2}px) scale(${state.zoom}) translate(${-state.x}px, ${-state.y}px)` }}>
			{children}
		</AbsoluteFill>
	);
}
