/**
 * Safe-area boxes. The bottom 17% stays free for captions the user may add in the editor, and a
 * 6% margin keeps marks off the edges.
 */

export type Box = { x: number; y: number; w: number; h: number; cx: number; cy: number };
export type AreaName = 'full' | 'hero' | 'left' | 'right' | 'top' | 'bottom';
export const AREA_NAMES: AreaName[] = ['full', 'hero', 'left', 'right', 'top', 'bottom'];

export const SAFE = { left: 0.06, right: 0.94, top: 0.06, bottom: 0.83 } as const;

export function box(x: number, y: number, w: number, h: number): Box {
	return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

export function safeBox(width: number, height: number): Box {
	return box(width * SAFE.left, height * SAFE.top, width * (SAFE.right - SAFE.left), height * (SAFE.bottom - SAFE.top));
}

export function area(name: AreaName, width: number, height: number): Box {
	const safe = safeBox(width, height);
	const gap = Math.min(width, height) * 0.04;
	switch (name) {
		case 'full':
			return safe;
		case 'hero':
			return box(safe.x + safe.w * 0.12, safe.y + safe.h * 0.12, safe.w * 0.76, safe.h * 0.76);
		case 'left':
			return box(safe.x, safe.y, (safe.w - gap) / 2, safe.h);
		case 'right':
			return box(safe.x + (safe.w + gap) / 2, safe.y, (safe.w - gap) / 2, safe.h);
		case 'top':
			return box(safe.x, safe.y, safe.w, (safe.h - gap) / 2);
		case 'bottom':
			return box(safe.x, safe.y + (safe.h + gap) / 2, safe.w, (safe.h - gap) / 2);
	}
}

/** Normalised [u, v] inside a box → pixels. */
export function place(target: Box, [u, v]: [number, number]): [number, number] {
	return [target.x + u * target.w, target.y + v * target.h];
}

/** Plot frame used by Axes, Scatter and FitLine: data [0,1]² inside the box with room for axis labels. */
export function plotBox(target: Box): Box {
	const pad = Math.min(target.w, target.h) * 0.1;
	return box(target.x + pad, target.y + pad * 0.4, target.w - pad * 1.4, target.h - pad * 1.4);
}

/** Data point (y up) → pixels in a plot box. */
export function plotPoint(target: Box, [u, v]: [number, number]): [number, number] {
	const plot = plotBox(target);
	return [plot.x + u * plot.w, plot.y + (1 - v) * plot.h];
}
