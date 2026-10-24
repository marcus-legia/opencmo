/**
 * kit.fx: backgrounds and finishing layers for free-form scenes. None of them is tagged for the layout report: they are
 * atmosphere, not the subject. Every one is a pure function of the frame (no CSS animation), so renders repeat exactly.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

import { noise } from './curves.ts';
import { kitError } from './context.tsx';

const COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgba?|hsla?)\([0-9.,%\s/-]+\))$/i;

function checkColor(value: string, where: string): string {
	if (typeof value !== 'string' || !COLOR.test(value.trim())) throw kitError(`${where}: "${String(value)}" is not a colour (#hex, rgb() or hsl()).`);
	return value.trim();
}

export type GradientFieldProps = {
	/** 2-6 colours; the first is the base, the others drift over it as soft blobs. */
	colors: string[];
	/** Drift speed: 1 is a slow, calm flow; 3 is lively. */
	speed?: number;
	seed?: number;
	/** Blob blur in px at 1080; larger is softer. */
	softness?: number;
};

/** An animated mesh-like gradient: soft colour blobs drifting on noise over a base colour. */
export function GradientField({ colors, speed = 1, seed = 1, softness = 160 }: GradientFieldProps) {
	if (!Array.isArray(colors) || colors.length < 2 || colors.length > 6) throw kitError('GradientField needs 2 to 6 colors.');
	const list = colors.map((color, i) => checkColor(color, `GradientField colors[${i}]`));
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const scale = Math.min(width, height) / 1080;
	const t = (frame / 90) * speed;
	const blobs = list.slice(1).map((color, i) => {
		const n = noise(seed * 31 + i * 7);
		const x = 0.5 + 0.38 * n(t + i * 3.1, 0.5);
		const y = 0.5 + 0.38 * n(t * 0.9 + i * 5.7, 2.5);
		const r = (0.55 + 0.15 * n(t * 0.6 + i, 4.5)) * Math.max(width, height);
		return { color, x: x * width, y: y * height, r };
	});
	return (
		<AbsoluteFill style={{ background: list[0], overflow: 'hidden' }}>
			<AbsoluteFill style={{ filter: `blur(${softness * scale}px)` }}>
				{blobs.map((blob, i) => (
					<div
						key={i}
						style={{ position: 'absolute', left: blob.x - blob.r / 2, top: blob.y - blob.r / 2, width: blob.r, height: blob.r, borderRadius: '50%', background: `radial-gradient(circle, ${blob.color} 0%, transparent 68%)` }}
					/>
				))}
			</AbsoluteFill>
		</AbsoluteFill>
	);
}

/** Film grain over everything below it; re-seeded every 2 frames, so it shimmers like film rather than crawls. */
export function Grain({ opacity = 0.07, seed = 0 }: { opacity?: number; seed?: number }) {
	const frame = useCurrentFrame();
	const id = `grain-${seed}`;
	return (
		<AbsoluteFill style={{ pointerEvents: 'none', opacity, mixBlendMode: 'overlay' }}>
			<svg width="100%" height="100%">
				<filter id={id}>
					<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed + Math.floor(frame / 2)} stitchTiles="stitch" />
					<feColorMatrix type="saturate" values="0" />
				</filter>
				<rect width="100%" height="100%" filter={`url(#${id})`} />
			</svg>
		</AbsoluteFill>
	);
}

/** Darkened (or tinted) edges that pull the eye to the centre. */
export function Vignette({ strength = 0.45, color = '#000000' }: { strength?: number; color?: string }) {
	const c = checkColor(color, 'Vignette color');
	return <AbsoluteFill style={{ pointerEvents: 'none', background: `radial-gradient(ellipse 80% 75% at 50% 48%, transparent 45%, ${c} 140%)`, opacity: Math.min(1, Math.max(0, strength)) }} />;
}

/** A band of light that crosses the frame once, from `at` over `dur` frames (a sheen on a reveal). */
export function LightSweep({ at, dur = 30, angle = 20, color = 'rgba(255,255,255,0.35)', width: band = 0.22 }: { at: number; dur?: number; angle?: number; color?: string; width?: number }) {
	const frame = useCurrentFrame();
	if (!Number.isFinite(at)) throw kitError('LightSweep needs at (a frame).');
	const c = checkColor(color, 'LightSweep color');
	const t = (frame - at) / Math.max(1, dur);
	if (t < 0 || t > 1) return null;
	const pos = -band * 100 + t * (100 + 2 * band * 100);
	return (
		<AbsoluteFill
			style={{
				pointerEvents: 'none',
				mixBlendMode: 'screen',
				background: `linear-gradient(${90 + angle}deg, transparent ${pos - band * 50}%, ${c} ${pos}%, transparent ${pos + band * 50}%)`,
			}}
		/>
	);
}

/** A plain field of one colour or a CSS gradient string built from colours (for scenes that skip Stage). */
export function Fill({ color, to, angle = 180 }: { color: string; to?: string; angle?: number }) {
	const a = checkColor(color, 'Fill color');
	const b = to === undefined ? undefined : checkColor(to, 'Fill to');
	return <AbsoluteFill style={{ background: b ? `linear-gradient(${angle}deg, ${a}, ${b})` : a }} />;
}
