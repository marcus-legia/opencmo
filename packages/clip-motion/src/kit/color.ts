/**
 * Colour mixing in OKLab (kit.oklab): a perceptual space, so a change from lime to green or coral passes through
 * luminous colours instead of the muddy olive a straight RGB mix gives.
 */

import { kitError } from './context.tsx';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function hexToRgb(hex: string): [number, number, number] {
	if (typeof hex !== 'string' || !HEX.test(hex.trim())) throw kitError(`"${String(hex)}" is not a #rgb or #rrggbb colour.`);
	let h = hex.trim().slice(1);
	if (h.length === 3) h = h.replace(/./g, (c) => c + c);
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB 0..1 → OKLab (L, a, b). */
export function rgbToOklab([r, g, b]: [number, number, number]): [number, number, number] {
	const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab → sRGB 0..1, clamped. */
export function oklabToRgb([L, a, b]: [number, number, number]): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
	return rgb.map((c) => Math.min(1, Math.max(0, toGamma(c)))) as [number, number, number];
}

const toHex = (rgb: [number, number, number]) => `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;

/** `a` → `b` at `t` (0..1) through OKLab, as #rrggbb. */
export function oklab(a: string, b: string, t: number): string {
	const p = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
	const x = rgbToOklab(hexToRgb(a));
	const y = rgbToOklab(hexToRgb(b));
	return toHex(oklabToRgb([x[0] + (y[0] - x[0]) * p, x[1] + (y[1] - x[1]) * p, x[2] + (y[2] - x[2]) * p]));
}
