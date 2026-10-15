import React from 'react';
import { useVideoConfig } from 'remotion';

import { FAMILY } from '../remotion/fonts.ts';
import { plotBox, plotPoint, type Box as BoxShape } from './areas.ts';
import { kitError, MarkTag, TextTag, useArea, useColor, useLife, type AreaProp, type ColorProp, type LifeProps } from './context.tsx';
import { enter, ease } from './motion.ts';
import { alpha } from './theme.ts';

type XY = [number, number];

function glow(color: string, strength = 1): string {
	return `drop-shadow(0 0 ${4 * strength}px ${alpha(color, 0.9)}) drop-shadow(0 0 ${14 * strength}px ${alpha(color, 0.45)})`;
}

function requirePoint(name: string, value: unknown): XY {
	if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) throw kitError(`${name} must be [x, y] in pixels (got ${JSON.stringify(value)}).`);
	return value as XY;
}

/** An SVG layer only as large as its marks (plus glow room): filters cost per pixel of the layer. */
function Svg({ around, children, style }: { around: BoxShape; children: React.ReactNode; style?: React.CSSProperties }) {
	const margin = 48;
	const x = Math.floor(around.x - margin);
	const y = Math.floor(around.y - margin);
	const w = Math.ceil(around.w + margin * 2);
	const h = Math.ceil(around.h + margin * 2);
	return (
		<div style={{ position: 'absolute', left: x, top: y, width: w, height: h, pointerEvents: 'none', ...style }}>
			<svg width={w} height={h} viewBox={`${x} ${y} ${w} ${h}`} style={{ overflow: 'visible', display: 'block' }}>
				{children}
			</svg>
		</div>
	);
}

function bounds(points: XY[], pad: number): BoxShape {
	const xs = points.map((p) => p[0]);
	const ys = points.map((p) => p[1]);
	const x = Math.min(...xs) - pad;
	const y = Math.min(...ys) - pad;
	const w = Math.max(...xs) - x + pad;
	const h = Math.max(...ys) - y + pad;
	return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

export type LinkProps = LifeProps & { from: XY; to: XY; color?: ColorProp; width?: number; curve?: number; dashed?: boolean; dots?: boolean };

/** A line that draws itself between two points. `curve` bends it (fraction of its length). */
export function Link(props: LinkProps) {
	const from = requirePoint('Link from', props.from);
	const to = requirePoint('Link to', props.to);
	const life = useLife({ dur: 20, ...props });
	const color = useColor(props.color, 'signal');
	if (!life.visible) return null;
	const strokeWidth = props.width ?? 4;
	const dx = to[0] - from[0];
	const dy = to[1] - from[1];
	const bend = props.curve ?? 0;
	const control: XY = [(from[0] + to[0]) / 2 - dy * bend, (from[1] + to[1]) / 2 + dx * bend];
	const d = `M ${from[0]} ${from[1]} Q ${control[0]} ${control[1]} ${to[0]} ${to[1]}`;
	const dot = (point: XY, shown: number) => <circle cx={point[0]} cy={point[1]} r={strokeWidth * 1.8 * shown} fill={color} />;
	return (
		<>
			<MarkTag name="Link" target={bounds([from, to], strokeWidth * 2)} />
			<Svg around={bounds([from, to, control], strokeWidth * 2)} style={{ opacity: 1 - life.out, filter: glow(color) }}>
				<path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" pathLength={1} strokeDasharray={props.dashed ? '0.02 0.015' : '1 1'} strokeDashoffset={props.dashed ? 0 : 1 - life.p} opacity={props.dashed ? life.p : 1} />
				{props.dots !== false ? (
					<>
						{dot(from, Math.min(1, life.p * 3))}
						{dot(to, enter(life.frame, { at: (props.at ?? 0) + (props.dur ?? 20) * 0.8, dur: 8 }))}
					</>
				) : null}
			</Svg>
		</>
	);
}

export type BoxProps = LifeProps & { area?: AreaProp; x?: number; y?: number; w?: number; h?: number; color?: ColorProp; label?: string; dashed?: boolean };

/** A highlighted region: rounded, dashed by default, with an optional small label. */
export function Box(props: BoxProps) {
	const fromArea = useArea(props.area, 'hero');
	const life = useLife({ dur: 18, ...props }, ease.hero);
	const color = useColor(props.color, 'answer');
	const target = props.x !== undefined && props.y !== undefined && props.w !== undefined && props.h !== undefined ? { x: props.x, y: props.y, w: props.w, h: props.h } : fromArea;
	if (![target.x, target.y, target.w, target.h].every(Number.isFinite)) throw kitError('Box needs x, y, w, h in pixels or an area.');
	if (!life.visible) return null;
	const scale = 0.94 + 0.06 * life.p;
	const radius = Math.min(target.w, target.h) * 0.06;
	return (
		<>
			<MarkTag name="Box" target={{ ...target, cx: target.x + target.w / 2, cy: target.y + target.h / 2 }} />
			<Svg around={{ ...target, cx: 0, cy: 0 }} style={{ opacity: life.opacity, filter: glow(color, 0.7) }}>
				<g transform={`translate(${target.x + target.w / 2} ${target.y + target.h / 2}) scale(${scale}) translate(${-target.w / 2} ${-target.h / 2})`}>
					<rect width={target.w} height={target.h} rx={radius} fill={alpha(color, 0.06)} stroke={color} strokeWidth={3} strokeDasharray={props.dashed === false ? undefined : '14 10'} />
				</g>
			</Svg>
			{props.label ? (
				<div style={{ position: 'absolute', left: target.x + radius, top: target.y - 52, opacity: life.opacity }}>
					<TextTag name={props.label} size={36} style={{ fontFamily: FAMILY.mono, fontSize: 36, color, letterSpacing: '0.04em' }}>
						{props.label}
					</TextTag>
				</div>
			) : null}
		</>
	);
}

export type CheckProps = LifeProps & { x?: number; y?: number; size?: number; color?: ColorProp; kind?: 'check' | 'cross' };

/** A ring that draws itself, then a check (or a cross). */
export function Check(props: CheckProps) {
	const { width, height } = useVideoConfig();
	const life = useLife({ dur: 26, ...props });
	const cross = props.kind === 'cross';
	const color = useColor(props.color, cross ? 'wrong' : 'answer');
	if (!life.visible) return null;
	const size = props.size ?? 160;
	const x = props.x ?? width / 2;
	const y = props.y ?? height * 0.45;
	const ring = Math.min(1, life.p * 1.6);
	const mark = enter(life.frame, { at: (props.at ?? 0) + 12, dur: 14, ease: ease.out });
	const r = size / 2;
	const path = cross
		? `M ${x - r * 0.35} ${y - r * 0.35} L ${x + r * 0.35} ${y + r * 0.35} M ${x + r * 0.35} ${y - r * 0.35} L ${x - r * 0.35} ${y + r * 0.35}`
		: `M ${x - r * 0.42} ${y + r * 0.02} L ${x - r * 0.1} ${y + r * 0.32} L ${x + r * 0.45} ${y - r * 0.3}`;
	return (
		<>
			<MarkTag name="Check" target={{ x: x - r, y: y - r, w: size, h: size, cx: x, cy: y }} />
			<Svg around={{ x: x - r, y: y - r, w: size, h: size, cx: x, cy: y }} style={{ opacity: 1 - life.out, filter: glow(color, 1.2) }}>
				<circle cx={x} cy={y} r={r} fill={alpha(color, 0.08 * ring)} stroke={color} strokeWidth={size * 0.045} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - ring} transform={`rotate(-90 ${x} ${y})`} />
				<path d={path} fill="none" stroke={color} strokeWidth={size * 0.07} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - mark} />
			</Svg>
		</>
	);
}

const ICONS: Record<string, string> = {
	mic: 'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z M5 11a7 7 0 0 0 14 0 M12 18v3 M8 21h8',
	music: 'M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
	phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M11 18h2',
	search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z M16 16l5 5',
	database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
	wave: 'M2 12h2 M6 8v8 M10 4v16 M14 7v10 M18 10v4 M22 12h-2',
	bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
	user: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z M4 21a8 8 0 0 1 16 0',
	lock: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
	server: 'M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01',
	cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 8Z',
	chart: 'M4 20V4 M4 20h16 M8 16v-4 M12 16V8 M16 16v-6',
	clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z M12 7v5l3 3',
	globe: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Z M3 12h18 M12 3c3 3.5 3 14.5 0 18 M12 3c-3 3.5-3 14.5 0 18',
	key: 'M8 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z M11 10h10 M18 10v3 M15 10v2',
	play: 'M7 4l13 8-13 8Z',
};
export const ICON_NAMES = Object.keys(ICONS);

export type IconProps = LifeProps & { name: string; x?: number; y?: number; size?: number; color?: ColorProp };

/** A small line icon that draws itself. Names: see ICON_NAMES. */
export function Icon(props: IconProps) {
	const { width, height } = useVideoConfig();
	const d = ICONS[props.name];
	if (!d) throw kitError(`unknown icon "${props.name}": use ${ICON_NAMES.join(', ')}.`);
	const life = useLife({ dur: 24, ...props });
	const color = useColor(props.color, 'text');
	if (!life.visible) return null;
	const size = props.size ?? 120;
	const x = props.x ?? width / 2;
	const y = props.y ?? height / 2;
	const scale = size / 24;
	return (
		<>
			<MarkTag name={`Icon ${props.name}`} target={{ x: x - size / 2, y: y - size / 2, w: size, h: size, cx: x, cy: y }} />
			<Svg around={{ x: x - size / 2, y: y - size / 2, w: size, h: size, cx: x, cy: y }} style={{ opacity: 1 - life.out, filter: glow(color, 0.8) }}>
				<g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${scale})`}>
					<path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - life.p} />
				</g>
			</Svg>
		</>
	);
}

export type AxesProps = LifeProps & { area?: AreaProp; x?: string; y?: string; color?: ColorProp };

/** Two axes drawn on, with optional names. Scatter and FitLine in the same area line up with them. */
export function Axes(props: AxesProps) {
	const target = useArea(props.area, 'hero');
	const life = useLife({ dur: 24, ...props });
	const color = useColor(props.color, 'dim');
	if (!life.visible) return null;
	const plot = plotBox(target);
	const origin: XY = [plot.x, plot.y + plot.h];
	const xEnd = enter(life.frame, { at: props.at ?? 0, dur: props.dur ?? 24 });
	const yEnd = enter(life.frame, { at: (props.at ?? 0) + 6, dur: props.dur ?? 24 });
	return (
		<>
			<MarkTag name="Axes" target={plot} />
			<Svg around={plot} style={{ opacity: 1 - life.out }}>
				<line x1={origin[0]} y1={origin[1]} x2={origin[0] + plot.w * xEnd} y2={origin[1]} stroke={color} strokeWidth={3} strokeLinecap="round" />
				<line x1={origin[0]} y1={origin[1]} x2={origin[0]} y2={origin[1] - plot.h * yEnd} stroke={color} strokeWidth={3} strokeLinecap="round" />
				{[0.25, 0.5, 0.75, 1].map((t) => (
					<g key={t} opacity={0.35 * xEnd}>
						<line x1={origin[0] + plot.w * t} y1={origin[1]} x2={origin[0] + plot.w * t} y2={plot.y} stroke={color} strokeWidth={1} strokeDasharray="4 10" />
						<line x1={origin[0]} y1={origin[1] - plot.h * t} x2={origin[0] + plot.w} y2={origin[1] - plot.h * t} stroke={color} strokeWidth={1} strokeDasharray="4 10" />
					</g>
				))}
			</Svg>
			{props.x ? (
				<div style={{ position: 'absolute', left: plot.x + plot.w, top: origin[1] + 18, transform: 'translateX(-100%)', opacity: xEnd * (1 - life.out) }}>
					<TextTag name={props.x} size={36} style={{ fontFamily: FAMILY.mono, fontSize: 36, color, whiteSpace: 'nowrap' }}>{props.x}</TextTag>
				</div>
			) : null}
			{props.y ? (
				<div style={{ position: 'absolute', left: plot.x + 16, top: plot.y - 8, opacity: yEnd * (1 - life.out) }}>
					<TextTag name={props.y} size={36} style={{ fontFamily: FAMILY.mono, fontSize: 36, color, whiteSpace: 'nowrap' }}>{props.y}</TextTag>
				</div>
			) : null}
		</>
	);
}

export type ScatterProps = LifeProps & {
	area?: AreaProp;
	points: { x: number; y: number }[];
	color?: ColorProp;
	size?: number;
	/** Indices that turn to the answer colour at `highlightAt` while the rest dim. */
	highlight?: number[];
	highlightAt?: number;
};

/** Points (0..1, y up) popping in one after another inside the plot of `area`. */
export function Scatter(props: ScatterProps) {
	if (!Array.isArray(props.points) || props.points.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) throw kitError('Scatter points must be [{ x, y }] between 0 and 1.');
	const target = useArea(props.area, 'hero');
	const life = useLife({ dur: 30, ...props });
	const color = useColor(props.color, 'signal');
	const answer = useColor(undefined, 'answer');
	const noise = useColor(undefined, 'noise');
	if (!life.visible) return null;
	const size = props.size ?? 10;
	const at = props.at ?? 0;
	const span = props.dur ?? 30;
	const each = props.points.length > 1 ? span / props.points.length : 0;
	const lit = props.highlightAt !== undefined ? enter(life.frame, { at: props.highlightAt, dur: 15 }) : 0;
	const chosen = new Set(props.highlight ?? []);
	return (
		<>
			<MarkTag name="Scatter" target={plotBox(target)} />
			<Svg around={plotBox(target)} style={{ opacity: 1 - life.out, filter: glow(color, 0.8) }}>
				{props.points.map((point, i) => {
					const [cx, cy] = plotPoint(target, [point.x, point.y]);
					const p = enter(life.frame, { at: at + i * each, dur: 12, ease: ease.hero });
					const highlighted = chosen.has(i);
					const fill = lit > 0 ? (highlighted ? answer : noise) : color;
					const r = size * p * (highlighted ? 1 + 0.5 * lit : 1 - 0.3 * lit);
					return <circle key={i} cx={cx} cy={cy} r={Math.max(0, r)} fill={fill} opacity={highlighted ? 1 : 1 - 0.5 * lit} />;
				})}
			</Svg>
		</>
	);
}

export type FitLineProps = LifeProps & { area?: AreaProp; from: XY; to: XY; color?: ColorProp; width?: number };

/** A line through the plot of `area` (data coordinates, 0..1, y up), drawn left to right. */
export function FitLine(props: FitLineProps) {
	const target = useArea(props.area, 'hero');
	const from = plotPoint(target, requirePoint('FitLine from', props.from));
	const to = plotPoint(target, requirePoint('FitLine to', props.to));
	const life = useLife({ dur: 24, ...props });
	const color = useColor(props.color, 'answer');
	if (!life.visible) return null;
	return (
		<>
			<MarkTag name="FitLine" target={bounds([from, to], 6)} />
			<Svg around={bounds([from, to], 6)} style={{ opacity: 1 - life.out, filter: glow(color, 1.1) }}>
				<line x1={from[0]} y1={from[1]} x2={from[0] + (to[0] - from[0]) * life.p} y2={from[1] + (to[1] - from[1]) * life.p} stroke={color} strokeWidth={props.width ?? 6} strokeLinecap="round" />
			</Svg>
		</>
	);
}
