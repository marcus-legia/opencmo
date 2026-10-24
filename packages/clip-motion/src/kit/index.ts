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
import { Board, BOARD_KINDS, Headline } from './board.tsx';
import { Arrow, Burst, Group, Path, Shape, SHAPE_KINDS } from './shapes.tsx';
import { Axes, Box as BoxMark, Check, FitLine, Icon, ICON_NAMES, Link, Scatter } from './marks.tsx';
import { ease, enter, lerp, morph, random, stagger } from './motion.ts';
import { Camera, Stage } from './stage.tsx';
import { makeDevices } from './devices.tsx';
import { makeImage } from './image.tsx';
import { Mark } from './mark.tsx';
import { curves, drawOn, noise, smear, snap, speedBlur, travel, tween } from './curves.ts';
import { Streak } from './streak.tsx';
import { Fill, GradientField, Grain, LightSweep, Vignette } from './fx.tsx';
import { makeShot, useShot } from './shot.tsx';
import { measure, Text } from './type.tsx';
import { FAMILY } from '../remotion/fonts.ts';
import { Counter, Label, Mono, Title } from './text.tsx';
import { makePalette } from './theme.ts';
import { buildTimeline, cueFrame, type Timeline } from './timing.ts';

export function makeKit(job: MotionJob, size: { width: number; height: number }, timeline: Timeline = buildTimeline(job)) {
	// The job's theme too: on paper, kit.color.text must be the dark ink the components use.
	const palette = makePalette(job.accent, job.theme);
	const Image = makeImage(job.assets ?? []);
	const { Phone, Browser } = makeDevices(Image);
	const beatAt = (i: number) => {
		const span = timeline.beats[i];
		if (!Number.isInteger(i) || !span) throw kitError(`kit.beat(${i}): this job has ${timeline.beats.length} beats (0–${timeline.beats.length - 1}).`);
		return span;
	};
	const Shot = makeShot(beatAt, timeline.beats.length);
	return Object.freeze({
		// Core: free-form scenes are built from these (read_guide "explainer", "Core")
		Mark,
		Text,
		measure,
		Shot,
		useShot,
		curves,
		tween,
		noise,
		drawOn,
		speedBlur,
		travel,
		snap,
		smear,
		Streak,
		fx: Object.freeze({ GradientField, Grain, Vignette, LightSweep, Fill }),
		font: Object.freeze({ ...FAMILY }),
		// Library: ready-made pieces, used only when they are the clearest picture
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
		Headline,
		Board,
		boards: BOARD_KINDS,
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
		// The user's own images (job.assets), by name
		Image,
		images: Object.freeze((job.assets ?? []).map((asset) => asset.name)),
		// Device frames for product moments
		Phone,
		Browser,
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
