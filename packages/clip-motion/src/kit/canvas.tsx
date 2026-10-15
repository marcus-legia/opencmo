import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';

import type { Box as BoxShape } from './areas.ts';
import { kitError, MarkTag, useArea, useColor, useLife, type AreaProp, type ColorProp, type LifeProps } from './context.tsx';
import type { Spectrum } from './data.ts';
import { ease, enter, random } from './motion.ts';
import { alpha, mix } from './theme.ts';

const SPRITE = 64;
const sprites = new Map<string, HTMLCanvasElement>();

/** Soft glowing disc, drawn once per colour and stamped with additive blending. */
function sprite(color: string): HTMLCanvasElement {
	let canvas = sprites.get(color);
	if (canvas) return canvas;
	canvas = document.createElement('canvas');
	canvas.width = canvas.height = SPRITE;
	const ctx = canvas.getContext('2d')!;
	const g = ctx.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
	g.addColorStop(0, alpha(mix(color, '#ffffff', 0.55), 1));
	g.addColorStop(0.1, alpha(color, 1));
	g.addColorStop(0.2, alpha(color, 0.45));
	g.addColorStop(0.45, alpha(color, 0.12));
	g.addColorStop(1, alpha(color, 0));
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, SPRITE, SPRITE);
	sprites.set(color, canvas);
	return canvas;
}

/** A canvas over `target` plus a margin so glow is not clipped. `draw` gets area-local pixels. */
function useCanvas(target: BoxShape, margin: number, draw: (ctx: CanvasRenderingContext2D) => void) {
	const ref = useRef<HTMLCanvasElement>(null);
	const width = Math.ceil(target.w + margin * 2);
	const height = Math.ceil(target.h + margin * 2);
	useLayoutEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.translate(margin, margin);
		draw(ctx);
	});
	return <canvas ref={ref} width={width} height={height} style={{ position: 'absolute', left: target.x - margin, top: target.y - margin, width, height }} />;
}

type Dot = { u: number; v: number; b: number; delay: number; phase: number };

export type DotFieldProps = LifeProps & {
	count?: number;
	seed?: number;
	area?: AreaProp;
	color?: ColorProp;
	/** Dot radius in px at full brightness. */
	size?: number;
	/** Halo strength, 0..2. */
	glow?: number;
	layout?: 'scatter' | 'grid' | 'cluster';
	/** Your own points instead of a random field: x, y normalised in the area, v = brightness 0..1. */
	points?: { x: number; y: number; v?: number }[];
	/** From this frame, dots dimmer than `threshold` fade to noise and the bright ones flare. */
	filterAt?: number;
	threshold?: number;
	/** Dots fly to these points (normalised in the area) from `morphAt`; several dots may share one. */
	morphTo?: { x: number; y: number }[];
	morphAt?: number;
	morphDur?: number;
	drift?: number;
};

/** Thousands of glowing dots: sound, data, people, stars. */
export function DotField(props: DotFieldProps) {
	const target = useArea(props.area, 'full');
	const life = useLife({ dur: 36, ...props });
	const color = useColor(props.color, 'signal');
	const noise = useColor(undefined, 'noise');
	const count = props.points ? props.points.length : Math.round(props.count ?? 600);
	if (!Number.isFinite(count) || count < 1 || count > 4000) throw kitError('DotField count must be between 1 and 4000.');
	const dots = useMemo<Dot[]>(() => {
		const rnd = random(props.seed ?? 1);
		const list: Dot[] = [];
		const columns = Math.ceil(Math.sqrt(count * (target.w / target.h)));
		for (let i = 0; i < count; i++) {
			const own = props.points?.[i];
			let u: number, v: number;
			if (own) [u, v] = [own.x, own.y];
			else if (props.layout === 'grid') [u, v] = [((i % columns) + 0.5) / columns, (Math.floor(i / columns) + 0.5) / Math.ceil(count / columns)];
			else if (props.layout === 'cluster') {
				const angle = rnd() * Math.PI * 2;
				const radius = Math.sqrt(-2 * Math.log(1 - rnd() * 0.999)) * 0.16;
				[u, v] = [0.5 + Math.cos(angle) * radius * (target.h / target.w), 0.5 + Math.sin(angle) * radius];
			} else [u, v] = [rnd(), rnd()];
			const b = own?.v ?? rnd() ** 2.4;
			list.push({ u, v, b, delay: rnd(), phase: rnd() * Math.PI * 2 });
		}
		return list;
	}, [count, props.seed, props.layout, props.points, target.w, target.h]);
	const size = props.size ?? 5;
	const glowScale = props.glow ?? 1;
	const at = props.at ?? 0;
	const span = props.dur ?? 36;
	const threshold = props.threshold ?? 0.7;
	const filter = props.filterAt !== undefined ? enter(life.frame, { at: props.filterAt, dur: 24, ease: ease.inOut }) : 0;
	const morphTargets = props.morphTo?.length ? props.morphTo : null;
	const canvas = useCanvas(target, size * 8 * glowScale + 8, (ctx) => {
		ctx.globalCompositeOperation = 'lighter';
		const signalSprite = sprite(color);
		const noiseSprite = sprite(noise);
		const frame = life.frame;
		const drift = (props.drift ?? 1) * Math.min(target.w, target.h) * 0.006;
		for (let i = 0; i < dots.length; i++) {
			const dot = dots[i]!;
			const shown = enter(frame, { at: at + dot.delay * span * 0.75, dur: 14 }) * (1 - life.out);
			if (shown <= 0) continue;
			let x = dot.u * target.w + Math.sin(frame * 0.035 + dot.phase) * drift;
			let y = dot.v * target.h + Math.cos(frame * 0.03 + dot.phase * 1.3) * drift;
			if (morphTargets && props.morphAt !== undefined) {
				const goal = morphTargets[i % morphTargets.length]!;
				const t = enter(frame, { at: props.morphAt + (i % 23) * 0.7, dur: props.morphDur ?? 40, ease: ease.hero });
				x += (goal.x * target.w - x) * t;
				y += (goal.y * target.h - y) * t;
			}
			const keep = dot.b >= threshold;
			const brightness = keep ? dot.b + (1 - dot.b) * filter : dot.b * (1 - 0.75 * filter);
			const radius = size * (0.45 + 0.75 * brightness) * (keep ? 1 + 0.5 * filter : 1 - 0.3 * filter);
			const halo = radius * 7 * glowScale;
			const signalAlpha = shown * (0.35 + 0.65 * brightness) * (keep ? 1 : 1 - filter);
			if (signalAlpha > 0.01) {
				ctx.globalAlpha = Math.min(1, signalAlpha);
				ctx.drawImage(signalSprite, x - halo / 2, y - halo / 2, halo, halo);
			}
			if (!keep && filter > 0) {
				ctx.globalAlpha = shown * filter * 0.55;
				ctx.drawImage(noiseSprite, x - halo / 2, y - halo / 2, halo, halo);
			}
		}
		ctx.globalAlpha = 1;
	});
	if (!life.visible) return null;
	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			<MarkTag name="DotField" target={target} />
			{canvas}
		</AbsoluteFill>
	);
}

export type SpectrogramProps = LifeProps & {
	data: Spectrum;
	area?: AreaProp;
	/** From this frame, everything but the peaks dims and the peaks light up. */
	peaksAt?: number;
	/** Only the peaks remain (constellation) from this frame. */
	constellationAt?: number;
};

/** Time × frequency heat map that sweeps in left to right. Data from kit.spectrogram(seed). */
export function Spectrogram(props: SpectrogramProps) {
	const data = props.data;
	if (!data || !Array.isArray(data.cells) || data.cells.length !== data.cols * data.rows) throw kitError('Spectrogram needs data from kit.spectrogram(seed).');
	const target = useArea(props.area, 'full');
	const life = useLife({ dur: 45, ...props });
	const low = useColor(undefined, 'field');
	const mid = useColor(undefined, 'noise');
	const high = useColor(undefined, 'signal');
	const answer = high;
	const cool = '#4F8FE8';
	const at = props.at ?? 0;
	const sweep = props.dur ?? 45;
	const peaks = props.peaksAt !== undefined ? enter(life.frame, { at: props.peaksAt, dur: 24, ease: ease.inOut }) : 0;
	const constellation = props.constellationAt !== undefined ? enter(life.frame, { at: props.constellationAt, dur: 24, ease: ease.inOut }) : 0;
	const peakSet = useMemo(() => new Set(data.peaks.map((peak) => peak.c * data.rows + peak.r)), [data]);
	const canvas = useCanvas(target, 60, (ctx) => {
		const cw = target.w / data.cols;
		const ch = target.h / data.rows;
		const gap = Math.max(1, Math.min(cw, ch) * 0.12);
		const fade = (1 - life.out) * (1 - constellation);
		for (let c = 0; c < data.cols; c++) {
			const shown = enter(life.frame, { at: at + (c / data.cols) * sweep, dur: 8 });
			if (shown <= 0) continue;
			for (let r = 0; r < data.rows; r++) {
				const v = data.cells[c * data.rows + r]!;
				const isPeak = peakSet.has(c * data.rows + r);
				const fill = v < 0.5 ? mix(low, mid, v / 0.5) : v < 0.8 ? mix(mid, cool, (v - 0.5) / 0.3) : mix(cool, high, (v - 0.8) / 0.2);
				ctx.globalAlpha = shown * fade * (isPeak ? 1 : 1 - 0.8 * peaks) * (0.3 + 0.7 * v);
				ctx.fillStyle = fill;
				ctx.beginPath();
				ctx.roundRect(c * cw + gap / 2, r * ch + gap / 2, cw - gap, ch - gap, gap);
				ctx.fill();
			}
		}
		const lit = Math.max(peaks, constellation);
		if (lit > 0) {
			ctx.globalCompositeOperation = 'lighter';
			const glowSprite = sprite(answer);
			for (const peak of data.peaks) {
				const shown = enter(life.frame, { at: at + (peak.c / data.cols) * sweep, dur: 8 });
				const halo = Math.min(cw, ch) * 3.2;
				ctx.globalAlpha = lit * shown * (1 - life.out);
				ctx.drawImage(glowSprite, peak.x * target.w - halo / 2, peak.y * target.h - halo / 2, halo, halo);
			}
			ctx.globalCompositeOperation = 'source-over';
		}
		ctx.globalAlpha = 1;
	});
	if (!life.visible) return null;
	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			<MarkTag name="Spectrogram" target={target} />
			{canvas}
		</AbsoluteFill>
	);
}

export type WaveformProps = LifeProps & {
	area?: AreaProp;
	seed?: number;
	color?: ColorProp;
	/** 0..1: grey noise bars mixed in (a noisy room). */
	noise?: number;
	/** The noise fades away from this frame. */
	cleanAt?: number;
	amp?: number;
};

/** Audio bars that grow in left to right and keep breathing. */
export function Waveform(props: WaveformProps) {
	const { width } = useVideoConfig();
	const target = useArea(props.area, 'hero');
	const life = useLife({ dur: 40, ...props });
	const color = useColor(props.color, 'signal');
	const noiseColor = useColor(undefined, 'noise');
	const bar = Math.max(5, width / 220);
	const count = Math.max(8, Math.floor(target.w / (bar * 2)));
	const shape = useMemo(() => {
		const rnd = random(props.seed ?? 1);
		const p = [rnd() * 6, rnd() * 6, rnd() * 6];
		return Array.from({ length: count }, (_, i) => {
			const x = i / count;
			const envelope = 0.25 + 0.75 * Math.abs(Math.sin(x * 9 + p[0]!) * 0.6 + Math.sin(x * 23 + p[1]!) * 0.4);
			return { h: Math.min(1, envelope * (0.55 + 0.45 * rnd())), n: rnd(), phase: rnd() * 6.28 + p[2]! };
		});
	}, [count, props.seed]);
	const canvas = useCanvas(target, 40, (ctx) => {
		const at = props.at ?? 0;
		const span = props.dur ?? 40;
		const amp = props.amp ?? 0.85;
		const noiseLevel = (props.noise ?? 0) * (props.cleanAt !== undefined ? 1 - enter(life.frame, { at: props.cleanAt, dur: 30, ease: ease.inOut }) : 1);
		const mid = target.h / 2;
		const halo = alpha(color, 0.16);
		shape.forEach((item, i) => {
			const grow = enter(life.frame, { at: at + (i / count) * span, dur: 10, ease: ease.out }) * (1 - life.out);
			if (grow <= 0) return;
			const x = i * bar * 2 + bar / 2;
			const breathe = 0.82 + 0.18 * Math.sin(life.frame * 0.22 + item.phase);
			if (noiseLevel > 0) {
				const nh = target.h * 0.5 * noiseLevel * (0.3 + 0.7 * item.n) * (0.75 + 0.25 * Math.sin(life.frame * 0.5 + item.phase * 3)) * grow;
				ctx.fillStyle = alpha(noiseColor, 0.7);
				ctx.fillRect(x - bar / 2 + bar, mid - nh / 2, bar * 0.8, nh);
			}
			const h = Math.max(bar, target.h * amp * item.h * breathe * grow);
			// Cheap glow: a wide translucent bar under the solid one (shadowBlur per bar is slow in software GL).
			ctx.fillStyle = halo;
			ctx.beginPath();
			ctx.roundRect(x - bar * 1.25, mid - h / 2 - bar, bar * 2.5, h + bar * 2, bar * 1.25);
			ctx.fill();
			ctx.fillStyle = color;
			ctx.beginPath();
			ctx.roundRect(x - bar / 2, mid - h / 2, bar, h, bar / 2);
			ctx.fill();
		});
	});
	if (!life.visible) return null;
	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			<MarkTag name="Waveform" target={target} />
			{canvas}
		</AbsoluteFill>
	);
}
