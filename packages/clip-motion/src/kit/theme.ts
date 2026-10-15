/** Theme "Blueprint": a navy field where colour has meaning. */

export const BLUEPRINT = {
	signal: '#F7C548', // gold: the thing we follow
	answer: '#36E2C0', // teal: the result
	wrong: '#FF5A6E', // red: errors, noise we reject
	noise: '#5D6F96', // grey-blue: everything that does not matter
	text: '#EAF0FA',
	dim: '#93A3C4',
	field: '#0A1428',
} as const;

export type ColorName = keyof typeof BLUEPRINT;
export type Palette = Record<ColorName, string>;

export function makePalette(accent?: string): Palette {
	return { ...BLUEPRINT, ...(accent ? { answer: accent } : {}) };
}

/** `rgba()` of a #rrggbb colour. */
export function alpha(hex: string, a: number): string {
	const value = Number.parseInt(hex.slice(1), 16);
	return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${a})`;
}

export function mix(a: string, b: string, t: number): string {
	const pa = Number.parseInt(a.slice(1), 16);
	const pb = Number.parseInt(b.slice(1), 16);
	const channel = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
	return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`;
}
