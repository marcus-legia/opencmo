/**
 * Themes. Colour has the same meaning in both: signal = what we follow, answer = the result (the brand accent
 * replaces it), wrong = errors and what we reject, noise = what does not matter.
 */

import type { Theme } from '../job.ts';

/** "Blueprint": a navy field with glowing marks (v1). */
export const BLUEPRINT = {
	signal: '#F7C548', // gold: the thing we follow
	answer: '#36E2C0', // teal: the result
	wrong: '#FF5A6E', // red: errors, noise we reject
	noise: '#5D6F96', // grey-blue: everything that does not matter
	text: '#EAF0FA',
	dim: '#93A3C4',
	field: '#0A1428',
	ink: '#EAF0FA', // main lines and outlines
	accent2: '#7FA8FF', // a second, neutral highlight
	soft: '#14284D', // panels and soft fills
} as const;

/** "Paper": a warm off-white page, flat colours, soft shadows (science, health, people, how-to topics). */
export const PAPER = {
	signal: '#D98A00',
	answer: '#0E9E86',
	wrong: '#D9384E',
	noise: '#9AA6B8',
	text: '#1D2733',
	dim: '#5B6878',
	field: '#F6F1E7',
	ink: '#1D2733',
	accent2: '#3D6FD9',
	soft: '#E9E1D2',
} as const;

export type ColorName = keyof typeof BLUEPRINT;
export type Palette = Record<ColorName, string>;

export function makePalette(accent?: string, theme: Theme = 'blueprint'): Palette {
	return { ...(theme === 'paper' ? PAPER : BLUEPRINT), ...(accent ? { answer: accent } : {}) };
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
