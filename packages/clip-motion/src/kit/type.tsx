import React from 'react';

import { fontFamily, LIBRARY, ROLES } from '../remotion/fonts.ts';
import { kitError, TextTag, useLife, usePalette, type LifeProps } from './context.tsx';
import { ease } from './motion.ts';
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
