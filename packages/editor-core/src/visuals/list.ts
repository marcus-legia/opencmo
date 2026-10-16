/**
 * `add_list` (style skills, B6): a numbered list in the visual panel — "5 repos", "3 mistakes" —
 * whose rows light up one by one as the speaker reaches them.
 *
 * Rows are rect + text nodes; the reveal is opacity keyframes in the group's own seconds, so the
 * browser and the export draw the same frames. A row marked `blur` hides its label behind the blur
 * effect (the speaker is teasing it); the number and meta stay readable.
 */

import { z } from 'zod';

import { r2, textNode, THEME, tint, type Box, type Node } from './common';

export const listItem = z
	.object({
		label: z.string().trim().min(1).max(40),
		/** A short fact on the right: "12.4k", "free". */
		meta: z.string().trim().min(1).max(16).optional(),
		/** Hide the label behind a blur until the speaker names it. */
		blur: z.boolean().optional(),
	})
	.strict();

/** The builder's input (what `update_visual` rebuilds from): reveal times are the group's own seconds. */
export const listInput = z
	.object({
		items: z.array(listItem).min(2).max(7),
		reveal_at: z.array(z.number().min(0)).max(7).optional(),
	})
	.strict();
export type ListInput = z.infer<typeof listInput>;

const DIM = 0.4;
const FADE = 0.2;
const BLUR = 18;

/** Opacity keys: `from` until `at`, then `to` (and back to `from` at `until`). */
function steps(from: number, to: number, at: number, until?: number): Node {
	const keys = [
		{ time: 0, value: from },
		{ time: r2(Math.max(0, at - FADE / 2)), value: from },
		{ time: r2(at + FADE / 2), value: to },
		...(until !== undefined ? [{ time: r2(Math.max(at + FADE, until - FADE / 2)), value: to }, { time: r2(until + FADE / 2), value: from }] : []),
	];
	return { tracks: [{ property: 'opacity', keyframes: keys }] };
}

export function buildList(input: ListInput, area: Box): Node[] {
	const count = input.items.length;
	const gap = Math.round(area.height * 0.025);
	const rowHeight = Math.min(Math.round((area.height - gap * (count - 1)) / count), Math.round(area.width * 0.16));
	const top = area.y + (area.height - (rowHeight * count + gap * (count - 1))) / 2;
	const size = Math.round(rowHeight * 0.42);
	const pad = Math.round(rowHeight * 0.3);
	const reveal = input.reveal_at && input.reveal_at.length === count ? input.reveal_at : null;
	const out: Node[] = [];
	input.items.forEach((item, index) => {
		const y = r2(top + index * (rowHeight + gap));
		const row: Box = { x: area.x, y, width: area.width, height: rowHeight };
		const at = reveal?.[index];
		const next = reveal?.[index + 1];
		out.push({ kind: 'rect', name: `Row ${index + 1}`, ...row, cornerRadius: Math.round(rowHeight * 0.2), ...tint(THEME.panel, THEME.panelOpacity) });
		// The highlight sits on the row being talked about, until the next row takes it.
		if (at !== undefined) {
			out.push({ kind: 'rect', name: `Row ${index + 1} highlight`, ...row, cornerRadius: Math.round(rowHeight * 0.2), ...tint(THEME.accent, 0.28), ...steps(0, 1, at, next) });
		}
		// A fresh track per node: a shared object would be one element in two places.
		const lit = () => (at !== undefined ? steps(DIM, 1, at) : {});
		const number = textNode(String(index + 1), { x: area.x + pad, y, width: Math.round(size * 1.2), height: rowHeight }, { size, color: THEME.accent, weight: 800, align: 'left', shadow: false });
		out.push({ ...number, name: `Row ${index + 1} number`, ...lit() });
		const metaWidth = item.meta ? Math.round(item.meta.length * size * 0.62) : 0;
		const labelBox = { x: area.x + pad + Math.round(size * 1.6), y, width: Math.max(10, area.width - pad * 2 - Math.round(size * 1.6) - metaWidth - pad), height: rowHeight };
		const label = textNode(item.label, labelBox, { size, color: THEME.text, weight: 700, align: 'left', shadow: false });
		out.push({ ...label, name: `Row ${index + 1} label`, ...lit(), ...(item.blur ? { effects: [{ type: 'blur', value: BLUR }] } : {}) });
		if (item.meta) {
			const meta = textNode(item.meta, { x: area.x + area.width - pad - metaWidth, y, width: metaWidth, height: rowHeight }, { size: Math.round(size * 0.85), color: THEME.text, weight: 500, align: 'right', shadow: false });
			out.push({ ...meta, name: `Row ${index + 1} meta`, ...lit() });
		}
	});
	return out;
}
