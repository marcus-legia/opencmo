import React from 'react';
import { useVideoConfig } from 'remotion';

import { FAMILY } from '../remotion/fonts.ts';
import { useArea, useColor, useLife, kitError, TextTag, type AreaProp, type ColorProp, type LifeProps } from './context.tsx';
import { enter, ease } from './motion.ts';
import { alpha, mix } from './theme.ts';

type Anchor = 'center' | 'left' | 'right';

type Placed = { x?: number; y?: number; area?: AreaProp; anchor?: Anchor };

function usePosition({ x, y, area, anchor = 'center' }: Placed): React.CSSProperties {
	const target = useArea(area, 'hero');
	const px = x ?? (anchor === 'left' ? target.x : anchor === 'right' ? target.x + target.w : target.cx);
	const py = y ?? target.cy;
	if (!Number.isFinite(px) || !Number.isFinite(py)) throw kitError('x and y must be numbers of pixels.');
	const shift = anchor === 'center' ? '-50%' : anchor === 'right' ? '-100%' : '0';
	return { position: 'absolute', left: px, top: py, transform: `translate(${shift}, -50%)`, whiteSpace: 'nowrap' };
}

function requireText(name: string, text: unknown): string {
	if (typeof text !== 'string' || !text.trim()) throw kitError(`${name} needs a non-empty text.`);
	return text;
}

export type TitleProps = LifeProps & { text: string; kicker?: string; area?: AreaProp; x?: number; y?: number; size?: number; color?: ColorProp };

/** Big serif headline; words rise in one after another. */
export function Title(props: TitleProps) {
	const text = requireText('Title', props.text);
	const { width, height } = useVideoConfig();
	const life = useLife(props, undefined, 24, { exitEndsAt: true });
	const color = useColor(props.color, 'text');
	const kickerColor = useColor(undefined, 'signal');
	const position = usePosition({ ...props, anchor: 'center' });
	if (!life.visible) return null;
	const size = props.size ?? Math.round(Math.min(width, height) * 0.088);
	const words = text.split(/\s+/);
	const at = props.at ?? 0;
	return (
		<div style={{ ...position, whiteSpace: 'normal', width: Math.min(width * 0.84, size * 14), textAlign: 'center', opacity: 1 - life.out, translate: `0 ${-life.out * 16}px` }}>
			{props.kicker ? (
				<div style={{ fontFamily: FAMILY.mono, fontSize: Math.max(36, size * 0.4), color: kickerColor, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: size * 0.35, opacity: enter(life.frame, { at, dur: 18 }) }}>
					{props.kicker}
				</div>
			) : null}
			<TextTag name={text} size={size} style={{ fontFamily: FAMILY.title, fontSize: size, lineHeight: 1.08, color, letterSpacing: '-0.015em', textShadow: `0 0 ${size * 0.4}px ${alpha(color, 0.25)}` }}>
				{words.map((word, i) => {
					const p = enter(life.frame, { at: at + 4 + i * 4, dur: 22, ease: ease.out });
					return (
						<span key={i} style={{ display: 'inline-block', opacity: p, transform: `translateY(${(1 - p) * size * 0.35}px)`, filter: `blur(${(1 - p) * 8}px)`, marginRight: i < words.length - 1 ? '0.25em' : 0 }}>
							{word}
						</span>
					);
				})}
			</TextTag>
		</div>
	);
}

export type LabelProps = LifeProps & Placed & {
	text: string;
	size?: number;
	color?: ColorProp;
	weight?: number;
	/** Replace the text at `swapAt`: the old words slide up, the new ones in. */
	swapTo?: string;
	swapAt?: number;
	/** Strike the text through in the "wrong" colour. */
	strikeAt?: number;
};

export function Label(props: LabelProps) {
	return <TextLine {...props} kind="Label" />;
}

export type MonoProps = LabelProps & { type?: boolean };

/** Data text (`f1 | f2 | gap`), typed in character by character. */
export function Mono(props: MonoProps) {
	return <TextLine {...props} kind="Mono" />;
}

function TextLine(props: MonoProps & { kind: 'Label' | 'Mono' }) {
	const text = requireText(props.kind, props.text);
	const mono = props.kind === 'Mono';
	const life = useLife(props, undefined, 15, { exitEndsAt: true });
	const color = useColor(props.color, mono ? 'signal' : 'text');
	const wrong = useColor(undefined, 'wrong');
	const noise = useColor(undefined, 'noise');
	const position = usePosition(props);
	if (!life.visible) return null;
	const size = props.size ?? (mono ? 44 : 52);
	const at = props.at ?? 0;
	// Sequential swap: the old words leave in 8 frames, then the new ones arrive in 10; never both at once.
	const swapOut = props.swapTo !== undefined && props.swapAt !== undefined ? enter(life.frame, { at: props.swapAt, dur: 8, ease: ease.inOut }) : 0;
	const swapIn = props.swapTo !== undefined && props.swapAt !== undefined ? enter(life.frame, { at: props.swapAt + 8, dur: 10, ease: ease.out }) : 0;
	const swap = swapIn >= 1 ? 1 : swapOut > 0 ? 0.5 : 0;
	const strike = props.strikeAt !== undefined ? enter(life.frame, { at: props.strikeAt, dur: 12, ease: ease.out }) : 0;
	const ink = strike > 0 ? mix(color, noise, strike * 0.7) : color;
	const typed = mono && props.type !== false ? Math.ceil(text.length * enter(life.frame, { at, dur: Math.max(10, text.length * 1.5), ease: ease.linear })) : text.length;
	const style: React.CSSProperties = {
		fontFamily: mono ? FAMILY.mono : FAMILY.text,
		fontSize: size,
		fontWeight: props.weight ?? (mono ? 500 : 600),
		letterSpacing: mono ? '0.02em' : '-0.01em',
		lineHeight: 1.15,
		color: ink,
		textShadow: `0 0 ${size * 0.45}px ${alpha(ink, 0.35)}`,
		fontVariantNumeric: 'tabular-nums',
	};
	const line = (value: string, offset: number, opacity: number) => (
		<span style={{ display: 'inline-block', transform: `translateY(${offset}px)`, opacity }}>{value}</span>
	);
	const shown = props.swapTo !== undefined && swapOut >= 1 ? props.swapTo : text;
	return (
		<div style={{ ...position, opacity: life.opacity, translate: `0 ${(1 - life.p) * 12}px` }}>
			<TextTag name={shown} size={size} style={{ ...style, position: 'relative' }}>
				{swap > 0 && swap < 1 && props.swapTo !== undefined ? (
					swapOut < 1 ? line(text, -swapOut * size * 0.6, 1 - swapOut) : line(props.swapTo, (1 - swapIn) * size * 0.6, swapIn)
				) : mono ? (
					<>
						<span>{shown.slice(0, typed)}</span>
						<span style={{ opacity: 0 }}>{shown.slice(typed)}</span>
					</>
				) : (
					shown
				)}
				{strike > 0 ? (
					<span style={{ position: 'absolute', left: -size * 0.1, top: '52%', height: Math.max(4, size * 0.08), width: `calc(${strike * 100}% + ${size * 0.2 * strike}px)`, background: wrong, borderRadius: 4, boxShadow: `0 0 ${size * 0.3}px ${alpha(wrong, 0.7)}` }} />
				) : null}
			</TextTag>
		</div>
	);
}

export type CounterProps = LifeProps & Placed & { to: number; from?: number; count?: number; size?: number; color?: ColorProp; prefix?: string; suffix?: string; decimals?: number };

/** A number that counts up over `count` frames (default 45) with ease-out. */
export function Counter(props: CounterProps) {
	if (!Number.isFinite(props.to)) throw kitError('Counter needs a numeric `to`.');
	const life = useLife(props, undefined, 12, { exitEndsAt: true });
	const color = useColor(props.color, 'answer');
	const position = usePosition(props);
	if (!life.visible) return null;
	const size = props.size ?? 120;
	const t = enter(life.frame, { at: props.at ?? 0, dur: props.count ?? 45, ease: ease.out });
	const value = (props.from ?? 0) + (props.to - (props.from ?? 0)) * t;
	const text = `${props.prefix ?? ''}${value.toLocaleString('en-US', { minimumFractionDigits: props.decimals ?? 0, maximumFractionDigits: props.decimals ?? 0 })}${props.suffix ?? ''}`;
	return (
		<div style={{ ...position, opacity: life.opacity }}>
			<TextTag name={text} size={size} style={{ fontFamily: FAMILY.text, fontWeight: 700, fontSize: size, color, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', textShadow: `0 0 ${size * 0.4}px ${alpha(color, 0.4)}` }}>
				{text}
			</TextTag>
		</div>
	);
}
