/**
 * v2 things to draw: shapes (a cell, a virus body, a pill…), free paths, arrows, groups that move together and
 * particle bursts. Every entrance uses the personality's wind-up and overshoot (`life.pop`); every mark tags its
 * box for the layout report.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { FAMILY } from '../remotion/fonts.ts';
import { kitError, MarkTag, TextTag, useColor, useGlow, useLife, useMotion, type ColorProp, type LifeProps } from './context.tsx';
import { requirePoint, Svg } from './marks.tsx';
import { ease, enter, random } from './motion.ts';
import { pop, wobble } from './personality.ts';
import { alpha } from './theme.ts';

type XY = [number, number];

export const SHAPE_KINDS = ['circle', 'cell', 'blob', 'ring', 'pill', 'capsule', 'star'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

function finite(name: string, values: number[]): void {
	if (!values.every(Number.isFinite)) throw kitError(`${name} needs numbers of pixels.`);
}

/** A closed wobbly outline around (cx, cy): the same seed gives the same blob, `t` makes it breathe. */
function blobPath(cx: number, cy: number, r: number, seed: number, t: number): string {
	const rand = random(seed);
	const n = 9;
	const phases = Array.from({ length: n }, () => rand() * Math.PI * 2);
	const amps = Array.from({ length: n }, () => 0.06 + rand() * 0.08);
	const points: XY[] = phases.map((phase, i) => {
		const angle = (i / n) * Math.PI * 2;
		const radius = r * (1 + amps[i]! * Math.sin(phase + t * 0.06));
		return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
	});
	// Closed Catmull-Rom through the points, as cubic Béziers.
	let d = `M ${points[0]![0]} ${points[0]![1]}`;
	for (let i = 0; i < n; i++) {
		const p0 = points[(i - 1 + n) % n]!;
		const p1 = points[i]!;
		const p2 = points[(i + 1) % n]!;
		const p3 = points[(i + 2) % n]!;
		d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
	}
	return `${d} Z`;
}

function starPath(cx: number, cy: number, r: number): string {
	const points = Array.from({ length: 10 }, (_, i) => {
		const angle = -Math.PI / 2 + (i * Math.PI) / 5;
		const radius = i % 2 ? r * 0.45 : r;
		return `${cx + Math.cos(angle) * radius} ${cy + Math.sin(angle) * radius}`;
	});
	return `M ${points.join(' L ')} Z`;
}

export type ShapeProps = LifeProps & {
	kind: ShapeKind;
	x?: number;
	y?: number;
	size?: number;
	color?: ColorProp;
	/** Second colour of a capsule's other half. */
	color2?: ColorProp;
	/** Soft fill inside the outline (default true). */
	fill?: boolean;
	/** A short label under the shape (at most 3 words). */
	label?: string;
	/** A halo that follows the shape in, a few frames late (the secondary motion layer). */
	secondary?: boolean;
	/** Slow breathing while on screen (the ambient layer). Default true for cell and blob. */
	breathe?: boolean;
	rotate?: number;
	seed?: number;
};

/** A filled, outlined shape that pops in: circle, cell (with a nucleus), blob, ring, pill, capsule, star. */
export function Shape(props: ShapeProps) {
	if (!SHAPE_KINDS.includes(props.kind)) throw kitError(`unknown shape "${String(props.kind)}": use ${SHAPE_KINDS.join(', ')}.`);
	const { width, height } = useVideoConfig();
	const motion = useMotion();
	const glow = useGlow();
	const life = useLife(props, ease.hero, 18);
	const color = useColor(props.color, 'answer');
	const color2 = useColor(props.color2, 'text');
	const size = props.size ?? Math.round(Math.min(width, height) * 0.16);
	const x = props.x ?? width / 2;
	const y = props.y ?? height * 0.45;
	finite('Shape', [x, y, size]);
	if (!life.visible) return null;
	const r = size / 2;
	const breathe = (props.breathe ?? (props.kind === 'cell' || props.kind === 'blob')) ? 1 + 0.025 * Math.sin((life.frame / 30) * Math.PI * 0.9) : 1;
	const scale = Math.max(0, life.pop) * breathe;
	const fill = props.fill === false ? 'none' : alpha(color, 0.18);
	const stroke = Math.max(3, size * 0.035);
	const at = props.at ?? 0;
	const halo = props.secondary ? enter(life.frame, { at: at + motion.style.follow, dur: Math.round(motion.style.enter * 1.4), ease: ease.out }) : 0;
	const pillW = size;
	const pillH = size * 0.42;
	let body: React.ReactNode;
	switch (props.kind) {
		case 'circle':
			body = <circle cx={x} cy={y} r={r} fill={fill} stroke={color} strokeWidth={stroke} />;
			break;
		case 'ring':
			body = <circle cx={x} cy={y} r={r} fill="none" stroke={color} strokeWidth={stroke * 1.4} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - life.p} transform={`rotate(-90 ${x} ${y})`} />;
			break;
		case 'cell':
			body = (
				<>
					<circle cx={x} cy={y} r={r} fill={fill} stroke={color} strokeWidth={stroke} />
					<circle cx={x} cy={y} r={r * 0.86} fill="none" stroke={alpha(color, 0.45)} strokeWidth={stroke * 0.5} />
					<circle cx={x + r * 0.18} cy={y - r * 0.1} r={r * 0.3} fill={alpha(color, 0.45)} stroke={color} strokeWidth={stroke * 0.6} />
				</>
			);
			break;
		case 'blob':
			body = <path d={blobPath(x, y, r, props.seed ?? 7, life.frame)} fill={fill} stroke={color} strokeWidth={stroke} />;
			break;
		case 'star':
			body = <path d={starPath(x, y, r)} fill={fill} stroke={color} strokeWidth={stroke} strokeLinejoin="round" />;
			break;
		case 'pill':
			body = <rect x={x - pillW / 2} y={y - pillH / 2} width={pillW} height={pillH} rx={pillH / 2} fill={fill} stroke={color} strokeWidth={stroke} />;
			break;
		case 'capsule':
			body = (
				<>
					<path d={`M ${x} ${y - pillH / 2} H ${x - pillW / 2 + pillH / 2} A ${pillH / 2} ${pillH / 2} 0 0 0 ${x - pillW / 2 + pillH / 2} ${y + pillH / 2} H ${x} Z`} fill={alpha(color, 0.55)} stroke={color} strokeWidth={stroke} />
					<path d={`M ${x} ${y - pillH / 2} H ${x + pillW / 2 - pillH / 2} A ${pillH / 2} ${pillH / 2} 0 0 1 ${x + pillW / 2 - pillH / 2} ${y + pillH / 2} H ${x} Z`} fill={alpha(color2, 0.55)} stroke={color2} strokeWidth={stroke} />
				</>
			);
			break;
	}
	const target = { x: x - r, y: y - (props.kind === 'pill' || props.kind === 'capsule' ? pillH / 2 : r), w: size, h: props.kind === 'pill' || props.kind === 'capsule' ? pillH : size, cx: x, cy: y };
	const labelSize = Math.max(36, Math.round(size * 0.2));
	return (
		<>
			<MarkTag name={`Shape ${props.kind}`} target={target} />
			<Svg around={{ x: x - r * 1.5, y: y - r * 1.5, w: size * 1.5, h: size * 1.5, cx: x, cy: y }} style={{ opacity: life.opacity, filter: glow(color, 0.8) }}>
				{halo > 0 ? <circle cx={x} cy={y} r={r * (1 + 0.35 * halo)} fill="none" stroke={alpha(color, 0.5 * (1 - halo))} strokeWidth={stroke * 0.8} /> : null}
				<g transform={`translate(${x} ${y}) rotate(${props.rotate ?? 0}) scale(${scale}) translate(${-x} ${-y})`}>{body}</g>
			</Svg>
			{props.label ? (
				<div style={{ position: 'absolute', left: x, top: target.y + target.h + labelSize * 0.4, transform: 'translateX(-50%)', opacity: life.opacity, whiteSpace: 'nowrap' }}>
					<TextTag name={props.label} size={labelSize} style={{ fontFamily: FAMILY.text, fontWeight: 600, fontSize: labelSize, color }}>
						{props.label}
					</TextTag>
				</div>
			) : null}
		</>
	);
}

export type PathProps = LifeProps & { d: string; x?: number; y?: number; size?: number; color?: ColorProp; fill?: boolean; draw?: boolean; width?: number };

/** A free SVG path in a 24×24 box (like icons), drawn on at `at`. For shapes the kit does not have. */
export function Path(props: PathProps) {
	if (typeof props.d !== 'string' || !/^[MmZzLlHhVvCcSsQqTtAa0-9.,\s+-]+$/.test(props.d) || !/^\s*[Mm]/.test(props.d)) throw kitError('Path d must be SVG path data starting with M (24×24 box).');
	const { width, height } = useVideoConfig();
	const glow = useGlow();
	const life = useLife(props, undefined, 26);
	const color = useColor(props.color, 'text');
	const size = props.size ?? 160;
	const x = props.x ?? width / 2;
	const y = props.y ?? height / 2;
	finite('Path', [x, y, size]);
	if (!life.visible) return null;
	const target = { x: x - size / 2, y: y - size / 2, w: size, h: size, cx: x, cy: y };
	const drawn = props.draw === false ? 1 : life.p;
	return (
		<>
			<MarkTag name="Path" target={target} />
			<Svg around={target} style={{ opacity: 1 - life.out, filter: glow(color, 0.7) }}>
				<g transform={`translate(${target.x} ${target.y}) scale(${size / 24})`}>
					<path d={props.d} fill={props.fill ? alpha(color, 0.2 * drawn) : 'none'} stroke={color} strokeWidth={props.width ?? 1.6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - drawn} />
				</g>
			</Svg>
		</>
	);
}

export type ArrowProps = LifeProps & { from: XY; to: XY; color?: ColorProp; width?: number; curve?: number; dashed?: boolean; head?: boolean };

/** An arrow that draws itself from `from` to `to` (pixels), its head popping in as the line lands. */
export function Arrow(props: ArrowProps) {
	const from = requirePoint('Arrow from', props.from);
	const to = requirePoint('Arrow to', props.to);
	const glow = useGlow();
	const motion = useMotion();
	const life = useLife(props, undefined, 20);
	const color = useColor(props.color, 'text');
	if (!life.visible) return null;
	const strokeWidth = props.width ?? 5;
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const bend = props.curve ?? 0;
	const control: XY = [(from[0] + to[0]) / 2 - dy * bend, (from[1] + to[1]) / 2 + dx * bend];
	const angle = Math.atan2(to[1] - control[1], to[0] - control[0]);
	const headSize = strokeWidth * 5;
	const at = props.at ?? 0;
	const dur = props.dur ?? Math.round(20 * (motion.explicit ? motion.style.enter / 18 : 1));
	const headIn = pop(Math.min(1, Math.max(0, (life.frame - at - dur * 0.75) / 8)), motion.explicit ? motion.style : { overshoot: 0, anticipation: 0, curve: ease.out });
	const left: XY = [to[0] - headSize * Math.cos(angle - 0.45), to[1] - headSize * Math.sin(angle - 0.45)];
	const right: XY = [to[0] - headSize * Math.cos(angle + 0.45), to[1] - headSize * Math.sin(angle + 0.45)];
	const xs = [from[0], to[0], control[0]];
	const ys = [from[1], to[1], control[1]];
	const around = { x: Math.min(...xs) - headSize, y: Math.min(...ys) - headSize, w: Math.max(...xs) - Math.min(...xs) + headSize * 2, h: Math.max(...ys) - Math.min(...ys) + headSize * 2, cx: 0, cy: 0 };
	return (
		<>
			<MarkTag name="Arrow" target={{ ...around, x: around.x + headSize / 2, y: around.y + headSize / 2, w: around.w - headSize, h: around.h - headSize }} />
			<Svg around={around} style={{ opacity: 1 - life.out, filter: glow(color, 0.8) }}>
				<path d={`M ${from[0]} ${from[1]} Q ${control[0]} ${control[1]} ${to[0]} ${to[1]}`} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" pathLength={1} strokeDasharray={props.dashed ? '0.025 0.02' : '1 1'} strokeDashoffset={props.dashed ? 0 : 1 - life.p} opacity={props.dashed ? life.p : 1} />
				{props.head !== false && headIn !== 0 ? (
					<g transform={`translate(${to[0]} ${to[1]}) scale(${Math.max(0, headIn)}) translate(${-to[0]} ${-to[1]})`}>
						<path d={`M ${left[0]} ${left[1]} L ${to[0]} ${to[1]} L ${right[0]} ${right[1]}`} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
					</g>
				) : null}
			</Svg>
		</>
	);
}

export type GroupKey = { at: number; x?: number; y?: number; scale?: number; rotate?: number; dur?: number };
export type GroupProps = LifeProps & {
	children?: React.ReactNode;
	/** Pivot for scale and rotate, in pixels (default: the frame centre). */
	x?: number;
	y?: number;
	/** Moves of the whole group: offsets in pixels from where its children are drawn, scale, rotate (degrees). */
	keys?: GroupKey[];
	/** A knock: at `at`, the group is pushed away from `from` and settles back. */
	react?: { at: number; from: XY; strength?: number };
};

/**
 * Children that move together. Each key eases from the previous state with the personality's wind-up and
 * overshoot; `react` adds a damped push away from an impact. Visibility follows `at` / `exitAt`.
 */
export function Group(props: GroupProps) {
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const motion = useMotion();
	const life = useLife({ ...props, dur: props.dur ?? 1 }, ease.linear, 1);
	const pivotX = props.x ?? width / 2;
	const pivotY = props.y ?? height / 2;
	finite('Group', [pivotX, pivotY]);
	if (!life.visible) return null;
	let state = { x: 0, y: 0, scale: 1, rotate: 0 };
	for (const key of [...(props.keys ?? [])].sort((a, b) => a.at - b.at)) {
		if (!Number.isFinite(key.at)) throw kitError('Group keys need `at` frames.');
		const dur = key.dur ?? Math.round(motion.style.enter * 1.6);
		const linear = dur <= 0 ? (frame >= key.at ? 1 : 0) : Math.min(1, Math.max(0, (frame - key.at) / dur));
		if (linear <= 0) break;
		const t = pop(linear, motion.explicit ? motion.style : { overshoot: 0, anticipation: 0, curve: ease.hero });
		const goal = { x: key.x ?? state.x, y: key.y ?? state.y, scale: key.scale ?? state.scale, rotate: key.rotate ?? state.rotate };
		state = { x: state.x + (goal.x - state.x) * t, y: state.y + (goal.y - state.y) * t, scale: state.scale + (goal.scale - state.scale) * t, rotate: state.rotate + (goal.rotate - state.rotate) * t };
	}
	if (props.react) {
		const from = requirePoint('Group react from', props.react.from);
		const dx = pivotX + state.x - from[0];
		const dy = pivotY + state.y - from[1];
		const length = Math.hypot(dx, dy) || 1;
		const push = (props.react.strength ?? 40) * wobble(frame, props.react.at, { length: 28, cycles: 1.25 });
		state = { ...state, x: state.x + (dx / length) * push, y: state.y + (dy / length) * push };
	}
	return (
		<div style={{ position: 'absolute', inset: 0, opacity: 1 - life.out, transformOrigin: `${pivotX}px ${pivotY}px`, transform: `translate(${state.x}px, ${state.y}px) rotate(${state.rotate}deg) scale(${state.scale})` }}>
			{props.children}
		</div>
	);
}

export type BurstProps = { at: number; x?: number; y?: number; count?: number; size?: number; color?: ColorProp; seed?: number };

/** A short particle burst (success, impact): streaks fly out from (x, y) and fade within 24 frames. */
export function Burst(props: BurstProps) {
	if (!Number.isFinite(props.at)) throw kitError('Burst needs an `at` frame.');
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const glow = useGlow();
	const color = useColor(props.color, 'signal');
	const x = props.x ?? width / 2;
	const y = props.y ?? height / 2;
	const size = props.size ?? 160;
	const count = Math.min(40, Math.max(4, Math.round(props.count ?? 14)));
	finite('Burst', [x, y, size]);
	const t = (frame - props.at) / 24;
	if (t < 0 || t >= 1) return null;
	const rand = random(props.seed ?? 3);
	const travel = ease.out(t);
	const streaks = Array.from({ length: count }, (_, i) => {
		const angle = (i / count) * Math.PI * 2 + rand() * 0.4;
		const reach = size * (0.6 + rand() * 0.4);
		const head = reach * travel;
		const tail = reach * Math.max(0, travel - 0.35);
		return <line key={i} x1={x + Math.cos(angle) * tail} y1={y + Math.sin(angle) * tail} x2={x + Math.cos(angle) * head} y2={y + Math.sin(angle) * head} stroke={color} strokeWidth={Math.max(3, size * 0.03)} strokeLinecap="round" />;
	});
	return (
		<Svg around={{ x: x - size, y: y - size, w: size * 2, h: size * 2, cx: x, cy: y }} style={{ opacity: 1 - t * t, filter: glow(color, 1) }}>
			{streaks}
		</Svg>
	);
}
