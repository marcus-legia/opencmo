/**
 * The motion kit handed to scene code as `kit`. The Assistant composes these primitives; colour,
 * type, easing and layout are decided here, once.
 */

import { DEFAULT_PERSONALITY, DEFAULT_THEME, FPS, type MotionJob } from '../job.ts';
import { area, place, plotPoint, type AreaName, type Box } from './areas.ts';
import { DotField, Spectrogram, Waveform } from './canvas.tsx';
import { kitError } from './context.tsx';
import { spectrogram, trend } from './data.ts';
import { LOTTIE_NAMES } from './lotties.ts';
import { Lottie } from './lottie.tsx';
import { Arrow, Burst, Group, Path, Shape, SHAPE_KINDS } from './shapes.tsx';
import { Axes, Box as BoxMark, Check, FitLine, Icon, ICON_NAMES, Link, Scatter } from './marks.tsx';
import { ease, enter, lerp, morph, random, stagger } from './motion.ts';
import { Camera, Stage } from './stage.tsx';
import { Counter, Label, Mono, Title } from './text.tsx';
import { makePalette } from './theme.ts';
import { buildTimeline, cueFrame, type Timeline } from './timing.ts';

export function makeKit(job: MotionJob, size: { width: number; height: number }, timeline: Timeline = buildTimeline(job)) {
	const palette = makePalette(job.accent);
	const beatAt = (i: number) => {
		const span = timeline.beats[i];
		if (!Number.isInteger(i) || !span) throw kitError(`kit.beat(${i}): this job has ${timeline.beats.length} beats (0–${timeline.beats.length - 1}).`);
		return span;
	};
	return Object.freeze({
		// Layout
		Stage,
		Camera,
		area: (name: AreaName) => {
			if (!['full', 'hero', 'left', 'right', 'top', 'bottom'].includes(name)) throw kitError(`unknown area "${name}": use full, hero, left, right, top or bottom.`);
			return area(name, size.width, size.height);
		},
		place: (target: Box, point: [number, number]) => place(target, point),
		plot: (target: Box, point: [number, number]) => plotPoint(target, point),
		width: size.width,
		height: size.height,
		portrait: size.height > size.width,
		theme: job.theme ?? DEFAULT_THEME,
		personality: job.personality ?? DEFAULT_PERSONALITY,
		fps: FPS,
		frames: timeline.frames,
		beats: timeline.beats.length,
		// Text
		Title,
		Label,
		Mono,
		Counter,
		// Data and marks
		DotField,
		Spectrogram,
		Waveform,
		Axes,
		Scatter,
		FitLine,
		Link,
		Box: BoxMark,
		Check,
		Icon,
		icons: ICON_NAMES,
		Lottie,
		lotties: LOTTIE_NAMES,
		Shape,
		shapes: SHAPE_KINDS,
		Path,
		Arrow,
		Group,
		Burst,
		spectrogram,
		trend,
		// Timing
		beat: (i: number) => {
			const { from, to, frames } = beatAt(i);
			return { from, to, frames };
		},
		cue: (i: number, word: string) => cueFrame(beatAt(i), word),
		at: (i: number, progress: number) => {
			const span = beatAt(i);
			return Math.round(span.from + Math.min(1, Math.max(0, progress)) * span.frames);
		},
		// Motion
		enter,
		morph,
		stagger,
		ease,
		lerp,
		random,
		// Colour
		color: Object.freeze({ ...palette }),
	});
}

export type Kit = ReturnType<typeof makeKit>;
