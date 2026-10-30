/**
 * `add_title`: a lower third, a name tag or a chapter title — what makes an interview clip look edited.
 *
 * Built from existing node kinds only (rect, path, text), so preview and export draw it through
 * `clip-render` like any other visual. Builders run on the server with no canvas: text is sized
 * with the width estimate below, and the exported-frame review is where real glyphs are checked.
 *
 * Motion only at build-in and build-out, still while it is read: in staggered (panel, accent,
 * title, sub), out faster and in reverse order. Title and sub rise per word / line inside their
 * line boxes (`unit` + `mask` of clip-render), so no text crosses the panel or the captions.
 */

import { z } from 'zod';

import { r2, SHADOW, strokePath, textNode, THEME, tint, wrapLabel, type Box, type Node } from './common';

export const TITLE_KINDS = ['lowerThird', 'nameTag', 'chapter'] as const;
export const TITLE_LOOKS = ['bar', 'kicker', 'card'] as const;
/** Named speeds, never seconds: the user and the Assistant pick a feel, the builder owns the timing. */
export const TITLE_MOTIONS = ['calm', 'standard', 'punchy'] as const;

export const titleInput = z
	.object({
		kind: z.enum(TITLE_KINDS).default('lowerThird'),
		/** The name, or the chapter title. */
		title: z.string().trim().min(1).max(60),
		/** Role, location, "Episode 12". */
		sub: z.string().trim().min(1).max(80).optional(),
		look: z.enum(TITLE_LOOKS).default('bar'),
		/** Default: left; a chapter title is centred. */
		side: z.enum(['left', 'right', 'center']).optional(),
		motion: z.enum(TITLE_MOTIONS).default('standard'),
	})
	.strict();

export type TitleInput = z.infer<typeof titleInput>;

const MOTION: Record<TitleInput['motion'], number> = { calm: 1.4, standard: 1, punchy: 0.7 };
/** A name tag is the compact form; a chapter title is read on its own, so it is larger. */
const KIND_SCALE: Record<TitleInput['kind'], number> = { lowerThird: 1, nameTag: 0.82, chapter: 1.35 };
/** Width of one bold character in em: wider than `textWidth`'s 0.56 because names are often capitalised and brand heading fonts run wider than Inter. */
const BOLD = 0.62;
const REGULAR = 0.56;

/** Inset every title stays inside (broadcast title-safe, ~5–6 %). */
export const TITLE_SAFE = 0.06;
/** Vertical frames: the platform's top bar and bottom buttons/description cover these bands on phones. */
export const UI_TOP = 0.1;
export const UI_BOTTOM = 0.16;

/** The box a title may use: title-safe, and clear of the platform UI zones on vertical frames. */
export function titleSafe(frame: { width: number; height: number }): Box {
	const vertical = frame.height > frame.width;
	const top = vertical ? Math.max(TITLE_SAFE, UI_TOP) : TITLE_SAFE;
	const bottom = vertical ? Math.max(TITLE_SAFE, UI_BOTTOM) : TITLE_SAFE;
	return {
		x: r2(frame.width * TITLE_SAFE),
		y: r2(frame.height * top),
		width: r2(frame.width * (1 - 2 * TITLE_SAFE)),
		height: r2(frame.height * (1 - top - bottom)),
	};
}

const sideOf = (input: TitleInput): 'left' | 'right' | 'center' => input.side ?? (input.kind === 'chapter' ? 'center' : 'left');

/**
 * Largest size ≤ `base` at which the longest line fits `max` by the estimate. A title that does
 * not fit on one line at 0.65 × base wraps to two lines rather than shrinking into an unreadable
 * size; past that it shrinks, so the estimate always fits.
 */
function fitLines(text: string, max: number, base: number, factor: number): { lines: string[]; size: number } {
	const fit = (lines: string[]) => Math.floor(Math.min(base, max / (Math.max(...lines.map((line) => line.length), 1) * factor)));
	const one = [text];
	if (fit(one) >= base * 0.65) return { lines: one, size: fit(one) };
	const two = wrapLabel(text, 2);
	return { lines: two, size: Math.max(12, fit(two)) };
}

const widthOf = (lines: string[], size: number, factor: number) => Math.max(...lines.map((line) => line.length), 1) * size * factor;
/**
 * The renderer wraps a word that runs past a text box's width, so a box sized exactly to the
 * estimate would break an all-caps name onto two lines. Text boxes get 20 % slack (the panel
 * stays sized to the estimate; the box itself is invisible).
 */
const SLACK = 1.2;

type Part = { role: 'panel' | 'band' | 'bar' | 'line' | 'title' | 'sub'; box: Box; lines?: string[]; size?: number };
type TitleLayout = { width: number; height: number; size: number; parts: Part[]; align: 'left' | 'right' | 'center' };

/**
 * Parts of the block in block-local pixels (origin at its top-left), laid out for the left side
 * and then mirrored or centred. `width` is the widest the block may be.
 */
export function layoutTitle(input: TitleInput, frame: { width: number; height: number }, width: number): TitleLayout {
	const align = sideOf(input);
	const base = Math.round(Math.min(frame.width, frame.height) * 0.055 * KIND_SCALE[input.kind]);
	const padX = Math.round(base * 0.5);
	const padY = Math.round(base * 0.32);
	// The bar look has no panel: a thick accent bar beside the text (or a short line under it when centred).
	const panel = input.look !== 'bar';
	const sideBar = input.look === 'bar' && align !== 'center';
	const barWidth = Math.max(4, Math.round(base * 0.14));
	const barGap = Math.round(base * 0.4);
	const contentX = panel ? padX : sideBar ? barWidth + barGap : 0;
	const room = width * 0.9 - contentX - (panel ? padX : 0);

	const title = fitLines(input.title, room, base, BOLD);
	const titleWidth = widthOf(title.lines, title.size, BOLD);
	const subBase = Math.max(12, Math.round(title.size * 0.52));
	const sub = input.sub ? fitLines(input.sub, input.look === 'kicker' ? room - padX : room, subBase, REGULAR) : null;
	const subWidth = sub ? widthOf(sub.lines, sub.size, REGULAR) : 0;
	const titleHeight = title.lines.length * title.size * 1.22;
	const subHeight = sub ? sub.lines.length * sub.size * 1.3 : 0;

	const parts: Part[] = [];
	let y = 0;
	let bandWidth = 0;
	if (input.look === 'kicker') {
		// The sub rides on an accent band above the panel; without a sub the band is a thin strip.
		const bandHeight = sub ? subHeight + sub.size * 0.5 : Math.max(4, Math.round(base * 0.12));
		bandWidth = sub ? subWidth + padX * 1.4 : 0;
		parts.push({ role: 'band', box: { x: 0, y, width: bandWidth, height: bandHeight } });
		if (sub) parts.push({ role: 'sub', box: { x: padX * 0.7, y: y + sub.size * 0.25, width: Math.min(room - padX, subWidth * SLACK), height: subHeight }, lines: sub.lines, size: sub.size });
		y += bandHeight;
	}
	const panelTop = y;
	if (panel) y += padY;
	parts.push({ role: 'title', box: { x: contentX, y, width: Math.min(room, titleWidth * SLACK), height: titleHeight }, lines: title.lines, size: title.size });
	y += titleHeight;
	if (input.look === 'card' || (input.look === 'bar' && align === 'center')) {
		const thickness = Math.max(3, Math.round(base * 0.07));
		y += base * 0.12;
		parts.push({ role: 'line', box: { x: contentX, y, width: Math.min(titleWidth, base * 3), height: thickness } });
		y += thickness;
	}
	if (sub && input.look !== 'kicker') {
		y += base * 0.18;
		parts.push({ role: 'sub', box: { x: contentX, y, width: Math.min(room, subWidth * SLACK), height: subHeight }, lines: sub.lines, size: sub.size });
		y += subHeight;
	}
	if (panel) y += padY;
	const contentWidth = Math.max(titleWidth, input.look === 'kicker' ? 0 : subWidth);
	const panelWidth = contentX + contentWidth + (panel ? padX : 0);
	const blockWidth = Math.max(panelWidth, bandWidth);
	if (panel) {
		// The kicker band is drawn on top of the panel's top edge: the panel starts under it.
		parts.unshift({ role: 'panel', box: { x: 0, y: panelTop, width: panelWidth, height: y - panelTop } });
		if (input.look === 'kicker' && !sub) parts.find((part) => part.role === 'band')!.box.width = panelWidth;
	}
	if (sideBar) parts.unshift({ role: 'bar', box: { x: 0, y: 0, width: barWidth, height: y } });

	// Mirror for the right side, centre each part for the centre.
	for (const part of parts) {
		if (align === 'right') part.box.x = blockWidth - part.box.x - part.box.width;
		else if (align === 'center' && part.role !== 'panel') part.box.x = (blockWidth - part.box.width) / 2;
	}
	return { width: blockWidth, height: y, size: title.size, parts, align };
}

/** Block size of a title laid out in `width` — the op uses it to find room above the captions. */
export function measureTitle(input: TitleInput, frame: { width: number; height: number }, width: number): { width: number; height: number } {
	const layout = layoutTitle(input, frame, width);
	return { width: layout.width, height: layout.height };
}

const at = (seconds: number) => r2(seconds);

/**
 * `area`: where the block may go, computed by the op (title-safe, clear of the captions). Lower
 * thirds and name tags sit on its bottom edge; chapter titles are centred in it.
 */
export function buildTitle(input: TitleInput, frame: { width: number; height: number }, area: Box, duration: number): Node[] {
	const layout = layoutTitle(input, frame, area.width);
	const left = layout.align === 'left' ? area.x : layout.align === 'right' ? area.x + area.width - layout.width : area.x + (area.width - layout.width) / 2;
	const top = input.kind === 'chapter' ? area.y + (area.height - layout.height) / 2 : area.y + area.height - layout.height;
	// A short title compresses its motion so in + hold + out still fit.
	const f = MOTION[input.motion] * Math.min(1, Math.max(0.4, duration / 2.5));
	const place = (box: Box): Box => ({ x: left + box.x, y: top + box.y, width: box.width, height: box.height });
	// Out runs from the end backwards: the larger the delay, the earlier it leaves.
	const fadeOut = (delay: number): Node => ({ type: 'fade', phase: 'out', duration: at(0.2 * f), ...(delay > 0 ? { delay: at(delay * f) } : {}) });
	// Grows a rect from its anchored edge (a wipe): left side grows right, right side grows left, centre from the middle.
	const wipe = (box: Box, delay: number, length: number): Node[] => {
		const start = at(delay * f);
		const end = at((delay + length) * f);
		const from = layout.align === 'left' ? box.x : layout.align === 'right' ? box.x + box.width : box.x + box.width / 2;
		return [
			{ property: 'width', keyframes: [{ time: start, value: 0, easing: 'easeOut' }, { time: end, value: r2(box.width) }] },
			...(from !== box.x ? [{ property: 'x', keyframes: [{ time: start, value: r2(from), easing: 'easeOut' }, { time: end, value: r2(box.x) }] }] : []),
		];
	};

	// The bar look has no panel behind the text: a tighter, darker shadow keeps white text readable
	// on bright shots (looked at on a near-white frame; the default shadow washed out).
	// A function, not a shared object: ids are stamped onto each node's own shadow.
	const shadows = () => (input.look === 'bar' ? { shadows: [{ ...SHADOW, blur: 10, offsetY: 2, opacity: 0.85 }] } : {});
	const out: Node[] = [];
	for (const part of layout.parts) {
		const box = place(part.box);
		const rect = { x: r2(box.x), y: r2(box.y), width: r2(box.width), height: r2(box.height) };
		if (part.role === 'panel') {
			out.push({ kind: 'rect', name: 'Panel', ...rect, cornerRadius: r2(layout.size * 0.16), ...tint(THEME.panel, THEME.panelOpacity), tracks: wipe(rect, 0, 0.35), animations: [fadeOut(0)] });
		} else if (part.role === 'band') {
			out.push({ kind: 'rect', name: 'Kicker', ...rect, cornerRadius: r2(Math.min(rect.height / 2, layout.size * 0.12)), fill: THEME.accent, tracks: wipe(rect, 0.1, 0.3), animations: [fadeOut(0.05)] });
		} else if (part.role === 'bar') {
			// Draws down from the top: height and nothing else, so the bar stays anchored.
			out.push({
				kind: 'rect',
				name: 'Accent bar',
				...rect,
				cornerRadius: r2(rect.width / 2),
				fill: THEME.accent,
				tracks: [{ property: 'height', keyframes: [{ time: at(0.1 * f), value: 0, easing: 'easeOut' }, { time: at(0.4 * f), value: rect.height }] }],
				animations: [fadeOut(0)],
			});
		} else if (part.role === 'line') {
			const y = rect.y + rect.height / 2;
			const [x0, x1] = layout.align === 'right' ? [rect.x + rect.width, rect.x] : [rect.x, rect.x + rect.width];
			const d = layout.align === 'center' ? `M ${r2(rect.x + rect.width / 2)} ${r2(y)} L ${r2(rect.x)} ${r2(y)} M ${r2(rect.x + rect.width / 2)} ${r2(y)} L ${r2(rect.x + rect.width)} ${r2(y)}` : `M ${r2(x0)} ${r2(y)} L ${r2(x1)} ${r2(y)}`;
			out.push({ ...strokePath(d, THEME.accent, rect.height, { drawAt: at(0.1 * f), drawFor: at(0.35 * f), shadow: false }), name: 'Accent line', animations: [fadeOut(0)] });
		} else if (part.role === 'title') {
			// Word by word, each word rising inside its own line box (the mask): the name builds without
			// crossing the panel edge or the captions below. Steps shrink on long titles so the
			// reveal stays short.
			const words = Math.max(1, part.lines!.join(' ').split(/\s+/).filter(Boolean).length);
			const step = r2(Math.max(0.02, Math.min(0.055 * f, (0.35 * f) / Math.max(1, words - 1))));
			out.push({
				...textNode(part.lines!.join('\n'), rect, { size: part.size!, align: layout.align, weight: 800 }),
				...shadows(),
				name: 'Title',
				animations: [{ type: 'slideUp', unit: 'word', mask: true, step, duration: at(0.3 * f + step * (words - 1)), delay: at(0.32 * f) }, fadeOut(0.05)],
			});
		} else {
			const onBand = input.look === 'kicker';
			out.push({
				...textNode(part.lines!.join('\n'), rect, { size: part.size!, align: layout.align, weight: 600, color: onBand ? THEME.onAccent : THEME.text, shadow: !onBand }),
				...(onBand ? {} : shadows()),
				name: 'Subtitle',
				// Line by line from behind its line box, after the title (on the kicker: out of the band).
				animations: [{ type: 'slideUp', unit: 'line', mask: true, duration: at(0.3 * f), delay: at(0.5 * f) }, fadeOut(0.1)],
			});
		}
	}
	return out;
}

/** Name of the group in the layers panel. */
export function titleName(input: TitleInput): string {
	const kind = input.kind === 'chapter' ? 'Chapter' : input.kind === 'nameTag' ? 'Name tag' : 'Lower third';
	return `${kind}: ${input.title}`;
}
