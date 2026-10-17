/**
 * `add_hook_title` (style skills, B4): the one- or two-line hook a talking head opens on. One line
 * (usually the promise) sits on an accent box in its own font, often an italic serif.
 *
 * Text nodes only: the accent box is the line's own `background`, which clip-render draws around the
 * measured glyphs, so the box always fits the text in the browser and in the export. The builder
 * runs without a canvas, so the font size comes from the same width estimate as the other titles.
 */

import { z } from 'zod';

import { FONTS } from '@opencmo/clip-render';

import { r2, SHADOW, THEME, type Box, type Node } from './common';

const FONT_NAMES = Object.keys(FONTS) as [string, ...string[]];

export const hookInput = z
	.object({
		/** One or two short lines: the topic, then the promise. */
		lines: z.array(z.string().trim().min(1).max(40)).min(1).max(2),
		/** The line on the accent box (default: the last line). */
		accent_line: z.union([z.literal(1), z.literal(2)]).optional(),
		accent_box: z.boolean().default(true),
		font_family: z.enum(FONT_NAMES).optional(),
		accent_font_family: z.enum(FONT_NAMES).optional(),
		accent_font_style: z.enum(['normal', 'italic']).optional(),
		/** Box colour (hex); default the brand accent. */
		accent_color: z
			.string()
			.regex(/^#[0-9a-fA-F]{6}$/)
			.optional(),
	})
	.strict()
	.refine((input) => (input.accent_line ?? 1) <= input.lines.length, { path: ['accent_line'], message: 'accent_line names a line the hook does not have.' });
export type HookInput = z.infer<typeof hookInput>;

/** Width of a heavy display character in em (estimate; real glyphs are checked on the exported frame). */
const CHAR = 0.6;
const MAX_SIZE = 96;
const MIN_SIZE = 40;
/** Ink on the accent box: dark, readable on a bright accent. */
const BOX_INK = '#111111';

/** The upper band the hook lives in: from the top of the safe box down to a third of the frame. */
export function hookArea(frame: { width: number; height: number }, safe: Box): Box {
	return { x: safe.x, y: safe.y, width: safe.width, height: r2(Math.max(frame.height / 3 - safe.y, frame.height * 0.12)) };
}

export function hookSize(lines: string[], width: number): number {
	const longest = Math.max(...lines.map((line) => line.length), 1);
	return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.floor(width / (longest * CHAR))));
}

export function buildHook(input: HookInput, area: Box): Node[] {
	const size = hookSize(input.lines, area.width * 0.9);
	const accent = input.accent_line ?? input.lines.length;
	const lineHeight = Math.round(size * 1.45);
	return input.lines.map((text, index) => {
		const isAccent = index + 1 === accent;
		const boxed = isAccent && input.accent_box;
		return {
			kind: 'text',
			name: isAccent ? 'Hook accent line' : 'Hook line',
			x: r2(area.x),
			y: r2(area.y + index * lineHeight),
			width: r2(area.width),
			height: lineHeight,
			text,
			fontFamily: (isAccent ? (input.accent_font_family ?? input.font_family) : input.font_family) ?? 'Inter',
			fontWeight: 800,
			...(isAccent && input.accent_font_style === 'italic' ? { fontStyle: 'italic' } : {}),
			fontSize: size,
			textAlign: 'center',
			textBaseline: 'middle',
			color: boxed ? BOX_INK : isAccent ? (input.accent_color ?? THEME.accent) : THEME.text,
			...(boxed
				? { background: { color: input.accent_color ?? THEME.accent, paddingX: Math.round(size * 0.3), paddingY: Math.round(size * 0.08), radius: Math.round(size * 0.18) } }
				: { shadows: [{ ...SHADOW }] }),
			// Line by line: pop in, the accent line a beat later; the group fades out.
			animations: [{ type: 'pop', phase: 'in', duration: 0.35, delay: r2(index * 0.15) }],
		} satisfies Node;
	});
}
