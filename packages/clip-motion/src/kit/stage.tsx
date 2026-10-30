import React, { useId } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

import { poseBlur, shots as shotList, type ShotMove } from './curves.ts';
import { kitError, useMotion, usePalette, useTheme } from './context.tsx';
import { ease, enter, random } from './motion.ts';
import { alpha } from './theme.ts';

export type StageProps = {
	children?: React.ReactNode;
	grid?: boolean;
	/** The ambient layer: soft motes drifting slowly behind everything. Default on when the job sets a personality. */
	ambient?: boolean;
};

/** Background life (the ambient motion layer): seeded motes that drift and breathe, never competing with marks. */
function Ambient({ color, light }: { color: string; light: boolean }) {
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const motes = React.useMemo(() => {
		const rand = random(11);
		return Array.from({ length: 26 }, () => ({ x: rand(), y: rand(), r: 3 + rand() * 7, speed: 0.15 + rand() * 0.35, phase: rand() * Math.PI * 2 }));
	}, []);
	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			{motes.map((mote, i) => {
				const y = (((mote.y * height - frame * mote.speed) % height) + height) % height;
				const x = mote.x * width + Math.sin(frame / 90 + mote.phase) * 24;
				const glowing = 0.35 + 0.35 * Math.sin(frame / 45 + mote.phase);
				return <div key={i} style={{ position: 'absolute', left: x, top: y, width: mote.r * 2, height: mote.r * 2, borderRadius: '50%', background: alpha(color, (light ? 0.1 : 0.22) * glowing + 0.04), filter: light ? undefined : `blur(${mote.r * 0.4}px)` }} />;
			})}
		</AbsoluteFill>
	);
}

/**
 * The field every scene sits on. Blueprint: navy gradient, slow-drifting grid, soft bloom, vignette. Paper: a warm
 * off-white page with a faint drifting grid and a light vignette.
 */
export function Stage({ children, grid = true, ambient }: StageProps) {
	const palette = usePalette();
	const theme = useTheme();
	const motion = useMotion();
	const alive = ambient ?? motion.explicit;
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const cell = Math.round(Math.min(width, height) / 12);
	const drift = (frame * 0.15) % cell;
	if (theme === 'paper') {
		return (
			<AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 80% at 50% 40%, #FFFDF8 0%, ${palette.field} 60%, #E8E0D1 100%)`, overflow: 'hidden' }}>
				{grid ? (
					<AbsoluteFill
						style={{
							backgroundImage: `linear-gradient(${alpha('#2B3A4F', 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha('#2B3A4F', 0.05)} 1px, transparent 1px)`,
							backgroundSize: `${cell}px ${cell}px`,
							backgroundPosition: `${drift}px ${drift * 0.6}px`,
							maskImage: 'radial-gradient(ellipse 75% 70% at 50% 45%, black 35%, transparent 100%)',
						}}
					/>
				) : null}
				{alive ? <Ambient color={palette.dim} light /> : null}
				<AbsoluteFill>{children}</AbsoluteFill>
				<AbsoluteFill style={{ background: 'radial-gradient(ellipse 125% 105% at 50% 45%, transparent 60%, rgba(90, 70, 40, 0.14) 100%)', pointerEvents: 'none' }} />
			</AbsoluteFill>
		);
	}
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
			{alive ? <Ambient color={palette.accent2} light={false} /> : null}
			<AbsoluteFill>{children}</AbsoluteFill>
			<AbsoluteFill style={{ background: 'radial-gradient(ellipse 120% 100% at 50% 45%, transparent 55%, rgba(2,5,12,0.55) 100%)', pointerEvents: 'none' }} />
		</AbsoluteFill>
	);
}

export type CameraKey = { at: number; focus?: [number, number]; zoom?: number; dur?: number };
export type CameraProps = {
	children?: React.ReactNode;
	keys?: CameraKey[];
	focus?: [number, number];
	zoom?: number;
	at?: number;
	dur?: number;
	/**
	 * A shot list instead of keys: `[{ from, to, pose: { scale, x, y } }, …]` (kit.shots). The camera holds between
	 * moves and blurs along the move in proportion to its speed, crisp again at rest.
	 */
	shots?: ShotMove[];
	/** Shot list only: blur strength (0 turns it off). */
	blur?: number;
};

/** The shot-list camera: poses joined by impulses, with motion blur from the pose change between frames. */
function ShotCamera({ children, moves, blur }: { children?: React.ReactNode; moves: ShotMove[]; blur: number }) {
	const frame = useCurrentFrame();
	const id = `camera-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
	const at = React.useMemo(() => shotList(moves), [moves]);
	const pose = at(frame);
	const smear = blur > 0 ? poseBlur(at(frame - 1), pose, { k: 0.13 * blur }) : { x: 0, y: 0 };
	const moving = smear.x > 0 || smear.y > 0;
	return (
		<AbsoluteFill style={{ transform: `translate(${pose.x}px, ${pose.y}px) scale(${pose.scale})`, filter: moving ? `url(#${id})` : undefined }}>
			{moving ? (
				<svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
					<filter id={id} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
						<feGaussianBlur stdDeviation={`${smear.x} ${smear.y}`} />
					</filter>
				</svg>
			) : null}
			{children}
		</AbsoluteFill>
	);
}

/** Slow push-ins and pans over everything inside. Each key eases from the previous framing; or a shot list. */
export function Camera({ children, keys, focus, zoom, at, dur, shots, blur = 1 }: CameraProps) {
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	if (shots !== undefined) {
		if (!Array.isArray(shots)) throw kitError('Camera shots must be a list of { from, to, pose } moves.');
		try {
			shotList(shots);
		} catch (error) {
			throw kitError((error as Error).message);
		}
		return <ShotCamera moves={shots} blur={Number.isFinite(blur) ? Math.max(0, blur) : 1}>{children}</ShotCamera>;
	}
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
