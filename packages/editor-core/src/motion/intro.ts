/**
 * Clip intro from a motion spec: the Builder of the Video agent team.
 *
 * The specialist agents only write an `IntroSpec` (words, beats, personality); everything that has
 * to be right — pixels, keyframes, easing, exit timing, brand colours — is decided here, in code,
 * so the same spec always builds the same intro. The result is ONE `add_intro` op that builds the
 * whole group: new elements get ids only after a batch, so "add, then animate" would take two
 * undo steps, and a never-edited blank document has no scene id an `insert_node` could target.
 */

import { z } from 'zod';

import type { ClipDocument } from '@opencmo/clip-doc';

import { readBrand } from '../brand';
import { clone } from '../doc';
import { checked } from '../ops/project';
import { activeScene } from '../ops/timeline';
import { r2, type Node } from '../visuals/common';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,23}$/, 'Element keys are short lowercase names like "title".');

export const PERSONALITIES = ['playful', 'premium', 'corporate', 'energetic'] as const;
export const INTRO_MOTIONS = ['fade', 'slide_up', 'slide_left', 'scale_in', 'pop', 'word_slide', 'draw'] as const;
export const INTRO_ELEMENTS = ['title', 'tagline', 'logo', 'accent_line'] as const;

export const introSpecSchema = z.object({
	personality: z.enum(PERSONALITIES),
	emotion: z.string().min(1).max(40),
	seconds: z.number().min(2).max(8),
	background: z.object({ style: z.enum(['gradient', 'solid', 'none']), colors: z.array(hex).min(1).max(3).optional() }),
	elements: z
		.array(
			z.object({
				key,
				kind: z.enum(INTRO_ELEMENTS),
				text: z.string().min(1).max(80).optional(),
				/** Vertical centre, 0–1 of the frame. On the title it moves the whole title/line/tagline block. */
				y: z.number().min(0.08).max(0.92).optional(),
			}),
		)
		.min(1)
		.max(6),
	beats: z
		.array(
			z.object({
				target: key,
				at: z.number().min(0).max(8),
				dur: z.number().min(0.1).max(4),
				motion: z.enum(INTRO_MOTIONS),
				easing: z.string().max(40).optional(),
			}),
		)
		.min(1)
		.max(12),
});
export type IntroSpec = z.infer<typeof introSpecSchema>;
export type Personality = (typeof PERSONALITIES)[number];

/**
 * Motion personality (motion-design skill, LottieFiles, MIT): one signature easing and the time
 * an entrance and the final exit take. The skill's UI durations are doubled for video: a viewer
 * has to read the words, not just notice a button. Exits are shorter than entrances.
 */
export const PERSONALITY: Record<Personality, { easing: string; enter: number; exit: number }> = {
	playful: { easing: 'spring(0.4, 500)', enter: 0.5, exit: 0.35 },
	premium: { easing: 'cubicBezier(0.4, 0, 0.2, 1)', enter: 0.9, exit: 0.6 },
	corporate: { easing: 'cubicBezier(0.2, 0, 0, 1)', enter: 0.6, exit: 0.4 },
	energetic: { easing: 'cubicBezier(0.16, 1, 0.3, 1)', enter: 0.35, exit: 0.25 },
};

/** Seconds a line of text must stay fully on screen to be read. */
export const READ_SECONDS = 1.2;
/** Most elements in motion at the same moment (skill's "1/3 rule" for small scenes). */
export const MAX_MOVING = 3;

/** Problems a reviewer would send back; empty means the spec builds a readable intro. */
export function reviewIntro(spec: IntroSpec, options: { hasLogo: boolean }): string[] {
	const issues: string[] = [];
	const keys = new Set(spec.elements.map((element) => element.key));
	if (keys.size !== spec.elements.length) issues.push('Two elements share a key.');
	const exitAt = spec.seconds - PERSONALITY[spec.personality].exit;
	for (const element of spec.elements) {
		if ((element.kind === 'title' || element.kind === 'tagline') && !element.text) issues.push(`${element.key}: a ${element.kind} needs text.`);
		if (element.kind === 'logo' && !options.hasLogo) issues.push(`${element.key}: this project has no brand logo; drop the logo element.`);
		const beats = spec.beats.filter((beat) => beat.target === element.key);
		if (beats.length !== 1) issues.push(`${element.key}: give it exactly one entrance beat (it has ${beats.length}).`);
	}
	for (const beat of spec.beats) {
		if (!keys.has(beat.target)) issues.push(`A beat targets "${beat.target}", which is not an element.`);
		if (beat.at + beat.dur > exitAt + 1e-6) issues.push(`${beat.target}: its entrance ends at ${r2(beat.at + beat.dur)}s, after the exit starts at ${r2(exitAt)}s.`);
		const element = spec.elements.find((item) => item.key === beat.target);
		if (element && (element.kind === 'title' || element.kind === 'tagline') && exitAt - (beat.at + beat.dur) < READ_SECONDS - 1e-6) {
			issues.push(`${beat.target}: the text is fully on screen for only ${r2(Math.max(0, exitAt - beat.at - beat.dur))}s; it needs ${READ_SECONDS}s to be read.`);
		}
		if (beat.motion === 'word_slide' && element && element.kind !== 'title' && element.kind !== 'tagline') issues.push(`${beat.target}: word_slide only works on text.`);
	}
	const hero = spec.elements[0]!;
	const heroBeat = spec.beats.find((beat) => beat.target === hero.key);
	if (heroBeat && spec.beats.some((beat) => beat.at < heroBeat.at - 1e-6)) issues.push(`${hero.key} is the hero (first element): nothing should enter before it.`);
	const moments = [...new Set(spec.beats.map((beat) => beat.at))];
	for (const moment of moments) {
		const moving = spec.beats.filter((beat) => beat.at <= moment + 1e-6 && beat.at + beat.dur > moment + 1e-6).length;
		if (moving > MAX_MOVING) issues.push(`${moving} elements move at ${r2(moment)}s; at most ${MAX_MOVING} at once, stagger them.`);
	}
	return issues;
}

type Frame = { width: number; height: number };

/** Keyframe tracks for one entrance; times are local to the element (0 = intro start). */
function entrance(motion: (typeof INTRO_MOTIONS)[number], at: number, dur: number, easing: string, frame: Frame, width: number): Node[] {
	const end = r2(at + dur);
	const from = (property: string, a: number, b: number, ease = easing): Node => ({
		property,
		keyframes: [
			{ time: r2(at), value: a, easing: ease },
			{ time: end, value: b },
		],
	});
	const fadeIn = from('opacity', 0, 1);
	switch (motion) {
		case 'fade':
			return [fadeIn];
		case 'slide_up':
			return [fadeIn, from('offsetY', r2(frame.height * 0.04), 0)];
		case 'slide_left':
			return [fadeIn, from('offsetX', r2(frame.width * 0.06), 0)];
		case 'scale_in':
			return [fadeIn, from('scale', 0.85, 1)];
		case 'pop':
			// Overshoot is the point of a pop: a spring, whatever the personality's curve.
			return [fadeIn, from('scale', 0.6, 1, 'spring(0.4, 500)')];
		case 'draw':
			return [from('width', 0, width)];
		case 'word_slide':
			return [];
	}
}

/** The intro group for the active timeline. */
export function buildIntro(spec: IntroSpec, document: ClipDocument): Node {
	const scene = activeScene(document) as unknown as { width: number; height: number };
	const frame: Frame = { width: scene.width, height: scene.height };
	const brand = readBrand(document);
	const colors = {
		background: brand?.colors.background ?? '#0B1020',
		primary: brand?.colors.primary ?? '#1E3A8A',
		accent: brand?.colors.accent ?? '#FACC15',
		text: brand?.colors.text ?? '#FFFFFF',
	};
	const fonts = { heading: brand?.fonts.heading ?? 'Montserrat', body: brand?.fonts.body ?? 'Inter' };
	const style = PERSONALITY[spec.personality];
	const short = Math.min(frame.width, frame.height);
	const children: Node[] = [];

	if (spec.background.style !== 'none') {
		const stops = spec.background.colors ?? [colors.background, colors.primary];
		children.push({
			kind: 'rect',
			name: 'Intro background',
			x: 0,
			y: 0,
			width: frame.width,
			height: frame.height,
			paints:
				spec.background.style === 'solid' || stops.length === 1
					? [{ type: 'solid', color: stops[0] }]
					: [{ type: 'linearGradient', rotation: 160, stops: stops.map((color, index) => ({ offset: r2(index / (stops.length - 1)), color })) }],
		});
	}

	// Title, accent line and tagline stack as one block, so a title that wraps never runs into the line.
	const textSize = (kind: 'title' | 'tagline') => Math.round(kind === 'title' ? short / 10 : short / 22);
	const textHeight = (kind: 'title' | 'tagline', text: string) => {
		const size = textSize(kind);
		return r2(size * 1.3 * Math.max(1, Math.ceil((text.length * size * 0.56) / (frame.width * 0.88))));
	};
	const lineHeight = Math.max(4, Math.round(short / 160));
	const gap = Math.round(short / 40);
	const order: Record<string, number> = { title: 0, accent_line: 1, tagline: 2 };
	const stack = spec.elements.filter((element) => element.kind in order).sort((a, b) => order[a.kind]! - order[b.kind]!);
	const heightOf = (element: (typeof stack)[number]) => (element.kind === 'accent_line' ? lineHeight : textHeight(element.kind as 'title' | 'tagline', element.text ?? ''));
	const blockHeight = stack.reduce((sum, element) => sum + heightOf(element), 0) + gap * Math.max(0, stack.length - 1);
	const titleY = spec.elements.find((element) => element.kind === 'title')?.y ?? 0.46;
	const top = new Map<string, number>();
	let cursor = Math.max(frame.height * 0.08, titleY * frame.height - blockHeight / 2);
	for (const element of stack) {
		top.set(element.key, r2(cursor));
		cursor += heightOf(element) + gap;
	}
	const blockTop = stack.length ? top.get(stack[0]!.key)! : frame.height * 0.46;

	spec.elements.forEach((element) => {
		const beat = spec.beats.find((item) => item.target === element.key)!;
		const easing = beat.easing ?? style.easing;
		const tracksFor = (width: number) => entrance(beat.motion, beat.at, beat.dur, easing, frame, width);
		if (element.kind === 'title' || element.kind === 'tagline') {
			const title = element.kind === 'title';
			const size = textSize(element.kind);
			const height = textHeight(element.kind, element.text ?? '');
			children.push({
				kind: 'text',
				name: title ? 'Intro title' : 'Intro tagline',
				x: r2(frame.width * 0.06),
				y: top.get(element.key)!,
				width: r2(frame.width * 0.88),
				height,
				text: element.text,
				color: colors.text,
				fontFamily: title ? fonts.heading : fonts.body,
				fontWeight: title ? 800 : 500,
				fontSize: size,
				textAlign: 'center',
				textBaseline: 'middle',
				shadows: [{ color: '#000000', blur: 14, offsetY: 3, opacity: 0.45 }],
				...(beat.motion === 'word_slide'
					? { animations: [{ type: 'wordSlide', phase: 'in', delay: r2(beat.at), perWord: r2(Math.max(0.05, beat.dur / Math.max(1, (element.text ?? '').split(/\s+/).length))) }] }
					: { tracks: tracksFor(0) }),
			});
			return;
		}
		if (element.kind === 'accent_line') {
			const width = r2(frame.width * 0.28);
			children.push({
				kind: 'rect',
				name: 'Intro accent line',
				x: r2((frame.width - width) / 2),
				y: top.get(element.key)!,
				width,
				height: lineHeight,
				cornerRadius: 3,
				paints: [{ type: 'solid', color: colors.accent }],
				tracks: tracksFor(width),
			});
			return;
		}
		if (element.kind === 'logo' && brand?.logo) {
			const size = r2(short * 0.2);
			const height = r2((size * brand.logo.height) / Math.max(1, brand.logo.width));
			children.push({
				kind: 'rect',
				name: 'Intro logo',
				x: r2((frame.width - size) / 2),
				y: r2(element.y !== undefined ? element.y * frame.height - height / 2 : Math.max(frame.height * 0.06, blockTop - gap * 2 - height)),
				width: size,
				height,
				paints: [{ type: 'image', src: `brand:${brand.logo.object}`, objectFit: 'contain' }],
				tracks: tracksFor(size),
			});
			return;
		}
	});

	return {
		kind: 'group',
		name: 'Intro',
		x: 0,
		y: 0,
		start: 0,
		end: spec.seconds,
		// The whole intro leaves together, faster than it came in, and reveals the clip below.
		animations: [{ type: 'fade', phase: 'out', duration: style.exit }],
		marks: { visual: { op: 'intro', input: spec } },
		children: children.map((child) => ({ start: 0, end: spec.seconds, ...child })),
	};
}

/** Adds the intro on top of the active timeline. Only the Video agent team's approval card calls it. */
export const addIntro = {
	name: 'add_intro',
	agent: false,
	input: z.object({ op: z.literal('add_intro'), spec: introSpecSchema }),
	describe: () => 'Add an intro',
	async apply(document: ClipDocument, input: { spec: IntroSpec }) {
		const next = clone(document);
		const scene = activeScene(next) as unknown as { children: Node[] };
		scene.children.push(buildIntro(input.spec, next));
		return checked(next, 'That intro cannot be added');
	},
};
