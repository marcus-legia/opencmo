/**
 * kit.fx: backgrounds and finishing layers for free-form scenes. None of them is tagged for the layout report: they are
 * atmosphere, not the subject. Every one is a pure function of the frame (no CSS animation), so renders repeat exactly.
 */

import React, { useId, useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, Freeze, useCurrentFrame, useVideoConfig } from 'remotion';

import { hexToRgb, rgbToOklab } from './color.ts';
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
		const r = (0.7 + 0.15 * n(t * 0.6 + i, 4.5)) * Math.max(width, height);
		return { color, x: x * width, y: y * height, r };
	});
	return (
		<AbsoluteFill style={{ background: list[0], overflow: 'hidden' }}>
			<AbsoluteFill style={{ filter: `blur(${softness * scale}px)` }}>
				{blobs.map((blob, i) => (
					<div
						key={i}
						style={{ position: 'absolute', left: blob.x - blob.r / 2, top: blob.y - blob.r / 2, width: blob.r, height: blob.r, borderRadius: '50%', background: `radial-gradient(circle, ${blob.color} 0%, ${blob.color} 22%, transparent 66%)` }}
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

/** Calls a render function with the frame of the sample it is drawn in (Freeze sets it). */
function Sampled({ render }: { render: (frame: number) => React.ReactNode }) {
	return <>{render(useCurrentFrame())}</>;
}

/**
 * Film-camera motion blur on a moving layer: the children are drawn at `samples` instants across the shutter
 * (180° = half a frame) and averaged. The motion must be computed from the frame INSIDE: pass a function
 * `(frame) => <…/>`, or components that read the frame themselves; a position computed outside is the same in every
 * sample and does not blur. Wrap only what travels fast; a layer at rest renders identically every sample, so it stays
 * sharp. Costs about `samples`× the layer's draw time. Only the newest sample is measured by the layout report.
 */
export function MotionBlur({ children, samples = 12, shutter = 180 }: { children?: React.ReactNode | ((frame: number) => React.ReactNode); samples?: number; shutter?: number }) {
	const frame = useCurrentFrame();
	if (!Number.isInteger(samples) || samples < 2 || samples > 64) throw kitError('MotionBlur samples must be a whole number from 2 to 64.');
	if (!Number.isFinite(shutter) || shutter <= 0 || shutter > 360) throw kitError('MotionBlur shutter must be between 1 and 360 degrees.');
	const span = shutter / 360;
	// Frame 0 has nothing before it: fewer samples there instead of looking into negative time.
	const n = Math.max(1, Math.min(samples, Math.floor((frame / span) * samples) + 1));
	return (
		<AbsoluteFill style={{ isolation: 'isolate' }}>
			{Array.from({ length: n }, (_, i) => {
				const time = n === 1 ? frame : frame - span + (span * (i + 1)) / n;
				return (
					<AbsoluteFill key={i} data-ghost={i < n - 1 ? '' : undefined} style={{ mixBlendMode: 'plus-lighter', filter: `opacity(${1 / n})` }}>
						<Freeze frame={Math.max(0, time)}>{typeof children === 'function' ? <Sampled render={children} /> : children}</Freeze>
					</AbsoluteFill>
				);
			})}
		</AbsoluteFill>
	);
}

/**
 * Liquid shapes: the children blur together and are cut back to a sharp edge, so shapes that touch merge with a neck
 * and pull apart like drops (a pill splitting into three circles). The sharp source is drawn over the merged shape,
 * so each shape keeps its exact size. After pf-cart-checkout (MIT, OpusClip).
 */
export function Goo({ children, blur = 12, style }: { children?: React.ReactNode; blur?: number; style?: React.CSSProperties }) {
	const id = `goo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
	if (!Number.isFinite(blur) || blur < 1 || blur > 40) throw kitError('Goo blur must be between 1 and 40 px.');
	return (
		<AbsoluteFill style={{ filter: `url(#${id})`, ...style }}>
			<svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
				<filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
					<feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="soft" />
					<feColorMatrix in="soft" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9" result="goo" />
					<feComposite in="SourceGraphic" in2="goo" operator="over" />
				</filter>
			</svg>
			{children}
		</AbsoluteFill>
	);
}

const SHADER = `#version 300 es
precision highp float;
uniform vec2 res;
uniform float t;
uniform float seed;
uniform float scale;
uniform float grain;
uniform int count;
uniform vec3 cols[6];
out vec4 outColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 17.13) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 toRgb(vec3 c) {
	float l = pow(c.x + 0.3963377774 * c.y + 0.2158037573 * c.z, 3.0);
	float m = pow(c.x - 0.1055613458 * c.y - 0.0638541728 * c.z, 3.0);
	float s = pow(c.x - 0.0894841775 * c.y - 1.2914855480 * c.z, 3.0);
	vec3 lin = vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
	lin = clamp(lin, 0.0, 1.0);
	return mix(lin * 12.92, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, lin));
}
void main() {
	vec2 uv = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y) / res.y;
	vec2 q = uv * scale;
	float w1 = vnoise(q * 1.1 + vec2(t * 0.06, -t * 0.04)) * 2.0 - 1.0;
	float w2 = vnoise(q * 2.3 + vec2(-t * 0.05, t * 0.03) + 7.0) * 2.0 - 1.0;
	float band = uv.x * 0.65 + uv.y * 0.45 + 0.32 * w1 + 0.12 * w2 + t * 0.015;
	float span = float(count - 1);
	float s = abs(fract(band * 0.55) * 2.0 - 1.0) * span;
	int i = int(min(floor(s), span - 1.0));
	vec3 lab = mix(cols[i], cols[i + 1], smoothstep(0.0, 1.0, s - float(i)));
	vec3 rgb = toRgb(lab);
	rgb += (hash(floor(gl_FragCoord.xy)) - 0.5) * 2.0 * grain;
	outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

let webgl2: boolean | null = null;

/** Whether this renderer gives WebGL2 (it depends on the Chromium GL backend), probed once. */
function hasWebgl2(): boolean {
	if (webgl2 === null) {
		const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('webgl2');
		webgl2 = ctx !== null;
		ctx?.getExtension('WEBGL_lose_context')?.loseContext();
	}
	return webgl2;
}

/**
 * A full-frame flowing colour field drawn by a fragment shader (the CSS GradientField with the same colours where the
 * renderer has no WebGL2): broad bands of 2-6 colours, blended in OKLab, slowly
 * warped and drifting, with static grain (no flicker). A pure function of the frame, so renders repeat exactly. After
 * pf-color-field (MIT, OpusClip); our own shader.
 */
export function ShaderField({ colors, speed = 1, seed = 1, scale = 1.6, grain = 0.012 }: { colors: string[]; speed?: number; seed?: number; scale?: number; grain?: number }) {
	if (!Array.isArray(colors) || colors.length < 2 || colors.length > 6) throw kitError('ShaderField needs 2 to 6 colors (#rrggbb).');
	if (!(grain >= 0 && grain <= 0.02)) throw kitError('ShaderField grain must be between 0 and 0.02.');
	const labs = colors.map((color) => rgbToOklab(hexToRgb(color)));
	return hasWebgl2() ? <ShaderCanvas labs={labs} speed={speed} seed={seed} scale={scale} grain={grain} /> : <GradientField colors={colors} speed={speed} seed={seed} />;
}

function ShaderCanvas({ labs, speed, seed, scale, grain }: { labs: [number, number, number][]; speed: number; seed: number; scale: number; grain: number }) {
	const frame = useCurrentFrame();
	const { width, height, fps } = useVideoConfig();
	const ref = useRef<HTMLCanvasElement>(null);
	const gl = useRef<{ ctx: WebGL2RenderingContext; program: WebGLProgram } | null>(null);
	useLayoutEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		if (!gl.current) {
			const ctx = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
			if (!ctx) throw kitError('ShaderField: WebGL2 is not available in this renderer.');
			const compile = (type: number, source: string) => {
				const shader = ctx.createShader(type)!;
				ctx.shaderSource(shader, source);
				ctx.compileShader(shader);
				if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) throw kitError(`ShaderField: ${ctx.getShaderInfoLog(shader) ?? 'shader failed'}`);
				return shader;
			};
			const program = ctx.createProgram()!;
			ctx.attachShader(program, compile(ctx.VERTEX_SHADER, VERTEX));
			ctx.attachShader(program, compile(ctx.FRAGMENT_SHADER, SHADER));
			ctx.linkProgram(program);
			ctx.useProgram(program);
			const buffer = ctx.createBuffer();
			ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
			ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
			const loc = ctx.getAttribLocation(program, 'p');
			ctx.enableVertexAttribArray(loc);
			ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
			gl.current = { ctx, program };
		}
		const { ctx, program } = gl.current;
		const u = (name: string) => ctx.getUniformLocation(program, name);
		ctx.viewport(0, 0, width, height);
		ctx.uniform2f(u('res'), width, height);
		ctx.uniform1f(u('t'), (frame / fps) * speed);
		ctx.uniform1f(u('seed'), seed);
		ctx.uniform1f(u('scale'), scale);
		ctx.uniform1f(u('grain'), grain);
		ctx.uniform1i(u('count'), labs.length);
		const flat = new Float32Array(18);
		labs.forEach((lab, i) => flat.set(lab, i * 3));
		ctx.uniform3fv(u('cols'), flat);
		ctx.drawArrays(ctx.TRIANGLES, 0, 3);
	});
	// The browser keeps a few live WebGL contexts per page: give this one back when the field leaves the scene.
	useLayoutEffect(
		() => () => {
			gl.current?.ctx.getExtension('WEBGL_lose_context')?.loseContext();
			gl.current = null;
		},
		[],
	);
	return <canvas ref={ref} width={width} height={height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
