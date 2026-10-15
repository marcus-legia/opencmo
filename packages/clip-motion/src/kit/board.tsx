/**
 * v2 text: the headline row and the text board. `Headline` owns the one headline row, so two headlines can never
 * be on screen together; `Board` shows up to three short lines (steps, facts, or a comparison).
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';

import { FAMILY } from '../remotion/fonts.ts';
import { area } from './areas.ts';
import { kitError, MarkTag, TextTag, useArea, useColor, useLife, useMotion, useTheme, type AreaProp, type ColorProp, type LifeProps } from './context.tsx';
import { ease, enter } from './motion.ts';
import { pop } from './personality.ts';
import { alpha } from './theme.ts';

const words = (text: string) => text.split(/\s+/).filter(Boolean);

export type HeadlineItem = { text: string; at: number; color?: ColorProp };
export type HeadlineProps = { items: HeadlineItem[]; y?: number; size?: number; exitAt?: number };

/**
 * The headline row. Item i shows from its `at` until the next item's `at`; it has fully left by then, and the
 * next one rises in after it, so headlines never overlap. Words rise one after another with the personality.
 */
export function Headline({ items, y, size, exitAt }: HeadlineProps) {
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const motion = useMotion();
	if (!Array.isArray(items) || !items.length) throw kitError('Headline needs items: [{ text, at }].');
	items.forEach((item, i) => {
		if (typeof item?.text !== 'string' || !item.text.trim()) throw kitError(`Headline item ${i} needs a text.`);
		if (!Number.isFinite(item.at)) throw kitError(`Headline item ${i} needs an \`at\` frame.`);
		if (words(item.text).length > 6) throw kitError(`Headline "${item.text}" is longer than 6 words: put the rest in a Board.`);
		if (i && item.at <= items[i - 1]!.at) throw kitError('Headline items must be in time order (each `at` after the previous one).');
	});
	const fontSize = size ?? Math.round(Math.min(width, height) * 0.06);
	const row = y ?? area('full', width, height).y + height * 0.07;
	const exitLength = motion.explicit ? motion.style.exit : 12;
	const index = items.findLastIndex((item) => frame >= item.at);
	if (index < 0) return null;
	const item = items[index]!;
	const end = index + 1 < items.length ? items[index + 1]!.at : exitAt;
	if (end !== undefined && frame >= end) return null;
	const leaving = end === undefined ? 0 : enter(frame, { at: Math.max(item.at + 1, end - exitLength), dur: Math.max(1, Math.min(exitLength, end - item.at - 1)), ease: ease.inOut });
	return <HeadlineLine key={index} text={item.text} at={item.at} y={row} size={fontSize} leaving={leaving} color={item.color} />;
}

function HeadlineLine({ text, at, y, size, leaving, color }: { text: string; at: number; y: number; size: number; leaving: number; color?: ColorProp }) {
	const frame = useCurrentFrame();
	const motion = useMotion();
	const ink = useColor(color, 'text');
	const list = words(text);
	const each = motion.explicit ? motion.style.stagger : 4;
	const dur = motion.explicit ? motion.style.enter : 18;
	return (
		<div style={{ position: 'absolute', left: '50%', top: y, transform: `translate(-50%, -50%) translateY(${-leaving * size * 0.4}px)`, opacity: 1 - leaving, whiteSpace: 'nowrap' }}>
			<TextTag name={text} size={size} style={{ fontFamily: FAMILY.text, fontWeight: 650, fontSize: size, color: ink, letterSpacing: '-0.015em', lineHeight: 1.15 }}>
				{list.map((word, i) => {
					const linear = Math.min(1, Math.max(0, (frame - at - i * each) / dur));
					const rise = motion.explicit ? pop(linear, motion.style) : ease.out(linear);
					const shown = ease.out(linear);
					return (
						<span key={i} style={{ display: 'inline-block', opacity: shown, transform: `translateY(${(1 - rise) * size * 0.45}px)`, marginRight: i < list.length - 1 ? '0.26em' : 0 }}>
							{word}
						</span>
					);
				})}
			</TextTag>
		</div>
	);
}

export const BOARD_KINDS = ['steps', 'facts', 'compare'] as const;

export type BoardProps = LifeProps & {
	lines: string[];
	title?: string;
	kind?: (typeof BOARD_KINDS)[number];
	area?: AreaProp;
	/** Frame each line appears (default: one after another from `at`). */
	lineAt?: number[];
	color?: ColorProp;
	size?: number;
};

/**
 * A text board: an optional title and up to 3 lines of at most 8 words, revealed one by one. `steps` numbers
 * them, `facts` bullets them, `compare` splits each line at " | " into two columns.
 */
export function Board(props: BoardProps) {
	const kind = props.kind ?? 'facts';
	if (!BOARD_KINDS.includes(kind)) throw kitError(`unknown Board kind "${String(kind)}": use ${BOARD_KINDS.join(', ')}.`);
	if (!Array.isArray(props.lines) || props.lines.length < 1 || props.lines.length > 3) throw kitError('Board needs 1 to 3 lines.');
	for (const line of props.lines) {
		if (typeof line !== 'string' || !line.trim()) throw kitError('Board lines must be non-empty text.');
		if (words(line.replace('|', ' ')).length > 8) throw kitError(`Board line "${line}" is longer than 8 words.`);
		if (kind === 'compare' && line.split('|').length !== 2) throw kitError(`A compare line needs "left | right" (got "${line}").`);
	}
	if (props.title !== undefined && words(props.title).length > 5) throw kitError('Board title must be at most 5 words.');
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const theme = useTheme();
	const motion = useMotion();
	const target = useArea(props.area, 'right');
	const life = useLife(props, undefined, 18, { exitEndsAt: true });
	const accent = useColor(props.color, 'answer');
	const ink = useColor(undefined, 'text');
	const dim = useColor(undefined, 'dim');
	if (!life.visible) return null;
	const size = props.size ?? Math.max(38, Math.round(Math.min(width, height) * 0.042));
	const at = props.at ?? 0;
	const step = (motion.explicit ? motion.style.stagger : 5) * 4;
	const lineAt = props.lineAt ?? props.lines.map((_, i) => at + 10 + i * step);
	if (lineAt.length !== props.lines.length || !lineAt.every(Number.isFinite)) throw kitError('Board lineAt needs one frame per line.');
	const pad = size * 0.7;
	const panel = theme === 'paper' ? alpha('#FFFFFF', 0.85) : alpha('#0E1C3A', 0.72);
	const edge = theme === 'paper' ? alpha('#1E2A3A', 0.12) : alpha(accent, 0.35);
	const rowHeight = size * 1.6;
	const titleSize = Math.max(36, Math.round(size * 0.78));
	const contentHeight = (props.title ? titleSize * 1.8 : 0) + props.lines.length * rowHeight;
	const box = { x: target.x, y: target.cy - (contentHeight + pad * 2) / 2, w: target.w, h: contentHeight + pad * 2 };
	const scale = 0.96 + 0.04 * Math.max(0, life.pop);
	return (
		<>
			<MarkTag name="Board" target={{ ...box, cx: box.x + box.w / 2, cy: box.y + box.h / 2 }} />
			<div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, opacity: life.opacity, transform: `scale(${scale})`, transformOrigin: 'center', background: panel, border: `2px solid ${edge}`, borderRadius: size * 0.5, padding: pad, boxSizing: 'border-box', boxShadow: theme === 'paper' ? '0 10px 30px rgba(40, 32, 20, 0.12)' : `0 0 40px ${alpha(accent, 0.12)}` }}>
				{props.title ? (
					<div style={{ height: titleSize * 1.8 }}>
						<TextTag name={props.title} size={titleSize} style={{ fontFamily: FAMILY.mono, fontSize: titleSize, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent }}>
							{props.title}
						</TextTag>
					</div>
				) : null}
				{props.lines.map((line, i) => {
					const t = enter(frame, { at: lineAt[i]!, dur: 14, ease: ease.out });
					if (t <= 0) return <div key={i} style={{ height: rowHeight }} />;
					const [left, right] = line.split('|').map((part) => part.trim());
					const marker =
						kind === 'steps' ? (
							<span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size * 1.05, height: size * 1.05, borderRadius: '50%', background: alpha(accent, 0.2), border: `2px solid ${accent}`, color: accent, fontSize: size * 0.6, fontWeight: 700, marginRight: size * 0.45, flex: 'none' }}>{i + 1}</span>
						) : kind === 'facts' ? (
							<span style={{ width: size * 0.32, height: size * 0.32, borderRadius: '50%', background: accent, marginRight: size * 0.5, flex: 'none' }} />
						) : null;
					return (
						<div key={i} style={{ height: rowHeight, display: 'flex', alignItems: 'center', opacity: t, transform: `translateX(${(1 - t) * size * 0.8}px)` }}>
							{marker}
							{kind === 'compare' ? (
								<>
									<TextTag name={left!} size={size} style={{ fontFamily: FAMILY.text, fontWeight: 600, fontSize: size, color: dim, flex: 1, whiteSpace: 'nowrap' }}>{left}</TextTag>
									<span style={{ color: accent, fontSize: size, margin: `0 ${size * 0.4}px` }}>→</span>
									<TextTag name={right!} size={size} style={{ fontFamily: FAMILY.text, fontWeight: 650, fontSize: size, color: ink, flex: 1, whiteSpace: 'nowrap' }}>{right}</TextTag>
								</>
							) : (
								<TextTag name={line} size={size} style={{ fontFamily: FAMILY.text, fontWeight: 600, fontSize: size, color: ink, whiteSpace: 'nowrap' }}>{line}</TextTag>
							)}
						</div>
					);
				})}
			</div>
		</>
	);
}
