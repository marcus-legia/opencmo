/**
 * The proof card (C5): a captured page in a browser frame that eases in on the words the speaker
 * quotes and marks them.
 *
 * Composition, not a new node kind (docs/style-skills-build.md, Decisions): rects for the frame,
 * a text for the real address, a masked group holding the page image and the marker. The zoom is
 * keyframes on the image's box, so the browser and the export draw the same frames. Times are the
 * card's own seconds; coordinates are scene pixels.
 */

import { r2, SHADOW, textNode, type Box, type Node } from '../visuals/common';
import type { FocusHit } from './find';

export const PROOF_MARKS = ['marker', 'box'] as const;
export type ProofMark = (typeof PROOF_MARKS)[number];

export type CardTimes = {
	/** The page eases from the whole width to the focus between these two (card seconds). */
	zoomFrom: number;
	zoomTo: number;
	/** When the marker grows across the focus. */
	markAt: number;
};

export type CardInput = {
	src: string;
	/** The address the page was captured at; the frame shows it as it is. */
	url: string;
	/** Captured page, CSS pixels. */
	page: { width: number; height: number };
	focus: FocusHit['rect'];
	zoom: number;
	mark: ProofMark;
	accent: string;
	times: CardTimes;
};

const FRAME = '#F1F3F5';
const URL_INK = '#3C4043';
const DOTS = ['#FF5F57', '#FEBC2E', '#28C840'];
const EASE = 'easeInOut';
const MARK_GROW = 0.35;

/** `github.com/owner/repo` from the captured address, shortened from the end to fit. */
export function displayUrl(url: string, maxChars: number): string {
	let shown = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
	if (shown.startsWith('www.')) shown = shown.slice(4);
	return shown.length > maxChars ? `${shown.slice(0, Math.max(1, maxChars - 1))}…` : shown;
}

/** The card's box inside `area`: as wide as the area, at most as tall as it is wide. */
export function cardBox(area: Box): Box {
	const height = Math.min(area.height, Math.round(area.width * 1.05));
	return { x: area.x, y: r2(area.y + (area.height - height) / 2), width: area.width, height };
}

type PageBox = { x: number; y: number; width: number; height: number; scale: number };

const clampRange = (value: number, min: number, max: number) => (min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value)));

/**
 * Where the page image sits at a given scale (scene px per CSS px) with `at` (a page point) placed
 * at `anchor` (a viewport point), slid so the page still covers the viewport wherever it can.
 */
function placePage(view: Box, page: CardInput['page'], scale: number, at: [number, number], anchor: [number, number]): PageBox {
	const width = page.width * scale;
	const height = page.height * scale;
	const x = clampRange(anchor[0] - at[0] * scale, view.x + view.width - width, view.x);
	const y = clampRange(anchor[1] - at[1] * scale, view.y + view.height - height, view.y);
	return { x: r2(x), y: r2(y), width: r2(width), height: r2(height), scale };
}

const keys = (property: string, from: number, to: number, times: CardTimes): Node => ({
	property,
	keyframes: [
		{ time: 0, value: from },
		{ time: r2(times.zoomFrom), value: from, easing: EASE },
		{ time: r2(times.zoomTo), value: to },
	],
});

export function buildCard(input: CardInput, area: Box, duration: number): Node[] {
	const card = cardBox(area);
	const radius = Math.round(card.width * 0.03);
	const bar = Math.max(28, Math.round(card.width * 0.075));
	const view: Box = { x: card.x, y: card.y + bar, width: card.width, height: card.height - bar };
	const { focus, page } = input;
	const centre: [number, number] = [focus.x + focus.width / 2, focus.y + focus.height / 2];

	// Whole width first, the focus a little above the middle; then the zoom, focus centred, never so
	// close that the marked words leave the frame.
	const fit = view.width / page.width;
	const widest = (view.width * 0.88) / Math.max(1, focus.width);
	const scale = Math.max(fit, Math.min(fit * input.zoom, widest));
	const from = placePage(view, page, fit, centre, [view.x + view.width / 2, view.y + view.height * 0.4]);
	const to = placePage(view, page, scale, centre, [view.x + view.width / 2, view.y + view.height / 2]);

	const dot = Math.round(bar * 0.26);
	const pill: Box = { x: card.x + Math.round(bar * 1.9), y: r2(card.y + bar * 0.2), width: card.width - Math.round(bar * 2.3), height: r2(bar * 0.6) };
	const urlSize = Math.max(12, Math.round(bar * 0.3));
	const chrome: Node[] = [
		{ kind: 'rect', name: 'Card', ...card, cornerRadius: radius, fill: '#FFFFFF', shadows: [{ ...SHADOW, blur: 24, offsetY: 8, opacity: 0.35 }] },
		{ kind: 'rect', name: 'Browser bar', x: card.x, y: card.y, width: card.width, height: bar, cornerRadiusTopLeft: radius, cornerRadiusTopRight: radius, fill: FRAME },
		...DOTS.map((color, index): Node => ({
			kind: 'rect',
			name: `Window button ${index + 1}`,
			x: r2(card.x + bar * 0.4 + index * dot * 1.7),
			y: r2(card.y + (bar - dot) / 2),
			width: dot,
			height: dot,
			cornerRadius: dot / 2,
			fill: color,
		})),
		{ kind: 'rect', name: 'Address bar', ...pill, cornerRadius: r2(pill.height / 2), fill: '#FFFFFF' },
		{
			...textNode(displayUrl(input.url, Math.floor((pill.width - bar * 0.6) / (urlSize * 0.56))), { x: pill.x + bar * 0.3, y: pill.y, width: pill.width - bar * 0.6, height: pill.height }, { size: urlSize, color: URL_INK, weight: 500, align: 'left', shadow: false }),
			name: 'Address',
		},
	];

	const pad = Math.max(4, Math.round(focus.height * to.scale * 0.18));
	const mark: Box = {
		x: r2(to.x + focus.x * to.scale - pad),
		y: r2(to.y + focus.y * to.scale - pad * 0.6),
		width: r2(focus.width * to.scale + pad * 2),
		height: r2(focus.height * to.scale + pad * 1.2),
	};
	const markAt = r2(input.times.markAt);
	const marker: Node =
		input.mark === 'marker'
			? {
					kind: 'rect',
					name: 'Marker',
					...mark,
					cornerRadius: r2(pad * 0.6),
					fill: input.accent.slice(0, 7),
					opacity: 0.45,
					blendMode: 'multiply',
					tracks: [{ property: 'width', keyframes: [{ time: 0, value: 0 }, { time: markAt, value: 0, easing: 'easeOut' }, { time: r2(markAt + MARK_GROW), value: mark.width }] }],
				}
			: {
					kind: 'rect',
					name: 'Marker',
					...mark,
					cornerRadius: r2(pad * 0.6),
					strokes: [{ color: input.accent.slice(0, 7), width: Math.max(3, Math.round(pad * 0.5)) }],
					tracks: [{ property: 'opacity', keyframes: [{ time: 0, value: 0 }, { time: markAt, value: 0 }, { time: r2(markAt + MARK_GROW), value: 1 }] }],
				};

	const span = { start: 0, end: r2(duration) };
	const pageGroup: Node = {
		kind: 'group',
		name: 'Page',
		x: 0,
		y: 0,
		// The viewport, rounded at the bottom like the card; the zoomed page never spills out.
		masks: [{ kind: 'rect', ...view, cornerRadiusBottomLeft: radius, cornerRadiusBottomRight: radius, fill: '#000000' }],
		children: [
			{
				kind: 'rect',
				name: 'Page image',
				...span,
				x: from.x,
				y: from.y,
				width: from.width,
				height: from.height,
				paints: [{ type: 'image', src: input.src, objectFit: 'fill' }],
				tracks: [keys('x', from.x, to.x, input.times), keys('y', from.y, to.y, input.times), keys('width', from.width, to.width, input.times), keys('height', from.height, to.height, input.times)],
			},
			{ ...marker, ...span },
		],
	};
	return [...chrome, pageGroup];
}
