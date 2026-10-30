import React from 'react';

import { fontFamily, LIBRARY, ROLES } from '../remotion/fonts.ts';
import { kitError, TextTag, useLife, usePalette, type LifeProps } from './context.tsx';
import { curves, type CurveName } from './curves.ts';
import { ease, type Ease } from './motion.ts';
import type { Palette } from './theme.ts';

export type FontName = keyof typeof ROLES | keyof typeof LIBRARY;

const isFont = (name: unknown): name is FontName => typeof name === 'string' && (name in ROLES || name in LIBRARY);
const FONT_NAMES = [...Object.keys(ROLES), ...Object.keys(LIBRARY)].join(', ');

export type TextProps = LifeProps & {
	text: string;
	/** The anchor: x is the left edge, the centre or the right edge by `align`; y is the top of the first line. */
	x: number;
	y: number;
	/** Wrap width in px; without it the text stays on one line. */
	w?: number;
	size: number;
	/** A role (title, text, mono, display) or any family of kit.fonts (Anton, Bebas Neue, DM Serif Display…). */
	font?: FontName;
	weight?: number;
	/** A palette name, #rgb/#rrggbb/#rrggbbaa, rgb()/rgba() or hsl()/hsla(). */
	color?: string;
	align?: 'left' | 'center' | 'right';
	/** Letter spacing in em (-0.06 for tight display type, 0.2 for small caps labels). */
	tracking?: number;
	lineHeight?: number;
	italic?: boolean;
	upper?: boolean;
	/** For the layout report and the jump check; defaults to the text. Unique per scene for words animated one by one. */
	name?: string;
	style?: React.CSSProperties;
};

const CSS_COLOR = /^(#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(rgba?|hsla?)\([0-9.,%\s/-]+\))$/i;

function colorOf(value: string | undefined, palette: Palette): string {
	if (value === undefined) return palette.text;
	if (value in palette) return palette[value as keyof Palette];
	if (CSS_COLOR.test(value.trim())) return value.trim();
	throw kitError(`Text color "${value}": use a palette name (${Object.keys(palette).join(', ')}), #hex, rgb() or hsl().`);
}

/**
 * `kit.Text`: free typography the layout report still checks (size, overlap, safe area). Any colour, font, weight and
 * tracking; no entrance of its own — the scene animates it (style transform/opacity/clipPath, or per-word Texts).
 */
export function Text(props: TextProps) {
	const palette = usePalette();
	if (typeof props.text !== 'string') throw kitError('Text needs text (a string).');
	if (![props.x, props.y, props.size].every(Number.isFinite) || props.size <= 0) throw kitError(`Text "${props.text.slice(0, 30)}" needs x, y and size in pixels.`);
	if (props.font !== undefined && !isFont(props.font)) throw kitError(`Text font "${String(props.font)}": use ${FONT_NAMES}.`);
	const life = useLife(props, ease.out, 0);
	if (!life.visible) return null;
	const align = props.align ?? 'left';
	const width = props.w;
	const left = align === 'left' ? props.x : align === 'center' ? props.x - (width ?? 0) / 2 : props.x - (width ?? 0);
	const shift = width === undefined ? (align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : '') : '';
	const style: React.CSSProperties = {
		position: 'absolute',
		left,
		top: props.y,
		...(width !== undefined ? { width } : { whiteSpace: 'pre' }),
		fontFamily: fontFamily(props.font ?? 'display'),
		fontSize: props.size,
		fontWeight: props.weight ?? 600,
		fontStyle: props.italic ? 'italic' : 'normal',
		letterSpacing: `${props.tracking ?? 0}em`,
		lineHeight: props.lineHeight ?? 1.1,
		textAlign: align,
		textTransform: props.upper ? 'uppercase' : 'none',
		color: colorOf(props.color, palette),
		opacity: 1 - life.out,
		...props.style,
		transform: [shift, props.style?.transform ?? ''].filter(Boolean).join(' ') || undefined,
	};
	return (
		<TextTag name={props.name ?? props.text} size={props.size} style={style}>
			{props.text}
		</TextTag>
	);
}

export type TypeStreamProps = Omit<TextProps, 'text'> & {
	/** One string, or lines (line breaks are layout only: the whole text is ONE stream). */
	text: string | string[];
	/** Frames the whole stream takes to emit, from `at`. */
	dur: number;
	/** Frames one letter takes to go from blurred and clear to sharp; letters overlap. Default 10 (about 1/3 s). */
	letter?: number;
	/** Starting blur of a letter in px. */
	blur?: number;
	/** How emission is spread over `dur`: a curve name or function (default: fast start, long thinning tail). */
	curve?: CurveName | Ease;
};

// After the screenplay stream of opus-pro/opusclip-video-tools templates/agent-opus (MIT, Copyright (c) 2026 OpusClip).
const STREAM_EMIT: Ease = (t) => {
	const shape = curves.soft;
	return shape(Math.min(1, Math.max(0, t)) * 0.8) / shape(0.8);
};

/**
 * `kit.TypeStream`: text that streams in letter by letter on one schedule for the whole paragraph, each letter
 * fading in from a blur to sharp. Resting letters carry no filter, so the text is crisp once it has landed.
 */
export function TypeStream(props: TypeStreamProps) {
	const palette = usePalette();
	const lines = Array.isArray(props.text) ? props.text : [props.text];
	if (!lines.length || !lines.every((line) => typeof line === 'string')) throw kitError('TypeStream needs text: a string or a list of lines.');
	if (![props.x, props.y, props.size, props.dur].every(Number.isFinite) || props.size <= 0 || props.dur <= 0) throw kitError('TypeStream needs x, y, size (px) and dur (frames).');
	if (props.font !== undefined && !isFont(props.font)) throw kitError(`TypeStream font "${String(props.font)}": use ${FONT_NAMES}.`);
	const life = useLife(props, ease.out, 0);
	if (!life.visible) return null;
	const at = props.at ?? 0;
	const letter = Math.max(1, props.letter ?? 10);
	const blur = Math.max(0, props.blur ?? 20);
	const emit = typeof props.curve === 'function' ? props.curve : props.curve ? curves[props.curve] : STREAM_EMIT;
	if (!emit) throw kitError(`TypeStream curve "${String(props.curve)}": use ${Object.keys(curves).join(', ')}.`);
	const total = lines.reduce((sum, line) => sum + Array.from(line).length, 0);
	// Letter i starts when the emission front reaches it: invert the curve once per letter.
	const startOf = (i: number) => {
		let lo = 0;
		let hi = 1;
		for (let step = 0; step < 24; step++) {
			const mid = (lo + hi) / 2;
			if (emit(mid) * total < i + 1) lo = mid;
			else hi = mid;
		}
		return at + ((lo + hi) / 2) * Math.max(1, props.dur - letter);
	};
	const align = props.align ?? 'left';
	const width = props.w;
	const left = align === 'left' ? props.x : align === 'center' ? props.x - (width ?? 0) / 2 : props.x - (width ?? 0);
	let index = 0;
	const style: React.CSSProperties = {
		position: 'absolute',
		left,
		top: props.y,
		...(width !== undefined ? { width } : { whiteSpace: 'pre' }),
		fontFamily: fontFamily(props.font ?? 'display'),
		fontSize: props.size,
		fontWeight: props.weight ?? 600,
		fontStyle: props.italic ? 'italic' : 'normal',
		letterSpacing: `${props.tracking ?? 0}em`,
		lineHeight: props.lineHeight ?? 1.1,
		textAlign: align,
		textTransform: props.upper ? 'uppercase' : 'none',
		color: colorOf(props.color, palette),
		opacity: 1 - life.out,
		...props.style,
		transform: [width === undefined ? (align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : '') : '', props.style?.transform ?? ''].filter(Boolean).join(' ') || undefined,
	};
	return (
		<TextTag name={props.name ?? lines.join(' ')} size={props.size} style={style}>
			{lines.map((line, row) => (
				<div key={row} style={{ whiteSpace: 'pre-wrap' }}>
					{/* Words stay whole when the line wraps: letters live inside a no-wrap word span. */}
					{line.split(/(\s+)/).filter(Boolean).map((word, w) => (
						<span key={w} style={{ whiteSpace: 'pre', display: /\s/.test(word) ? 'inline' : 'inline-block' }}>
							{Array.from(word).map((char, k) => {
								const p = curves.arrive(Math.min(1, Math.max(0, (life.frame - startOf(index++)) / letter)));
								return (
									<span key={k} style={{ display: 'inline-block', whiteSpace: 'pre', opacity: p, filter: p >= 1 || blur === 0 ? undefined : `blur(${(blur * (1 - p)).toFixed(2)}px)` }}>
										{char}
									</span>
								);
							})}
						</span>
					))}
				</div>
			))}
		</TextTag>
	);
}

let measureContext: CanvasRenderingContext2D | null = null;

/**
 * `kit.measure(text, { size, font, weight, tracking })` → the text's width in px with the kit's fonts (loaded before
 * frame 0). Scene code cannot touch the DOM, so word-by-word layouts measure here.
 */
export function measure(text: string, options: { size: number; font?: FontName; weight?: number; tracking?: number }): number {
	if (typeof text !== 'string' || !Number.isFinite(options?.size)) throw kitError('measure(text, { size, font?, weight?, tracking? }).');
	const { size, font = 'display', weight = 600, tracking = 0 } = options;
	if (!isFont(font)) throw kitError(`measure font "${String(font)}": use ${FONT_NAMES}.`);
	const extra = tracking * size * Math.max(0, text.length - 1);
	if (typeof document === 'undefined') return text.length * size * 0.56 + extra;
	measureContext ??= document.createElement('canvas').getContext('2d');
	if (!measureContext) return text.length * size * 0.56 + extra;
	measureContext.font = `${weight} ${size}px ${fontFamily(font)}`;
	return measureContext.measureText(text).width + extra;
}
