/**
 * `add_explainer`: places a finished explainer (Remotion animation + narration, rendered on the
 * worker by `packages/clip-motion`) as ONE generated video layer: full frame, or with `place` in the top or bottom
 * band of a split with the speaker in the other band, the split sized so the band is exactly the animation's shape. The op only writes the
 * `generate.video` declaration of model `motion-explainer`; the editor resolves it through
 * `/api/v1/generations` like any generation, and the layer shows render progress until the MP4 lands.
 *
 * `agent: false`: it costs credits, so the Assistant reaches it only through `add_explainer` (the
 * tool), whose price card the user approves first.
 */

import { z } from 'zod';

import type { AssetDeclaration, ClipDocument } from '@opencmo/clip-doc';

import { readCaptionStyle } from '../captions';
import { clone, sceneOf, walk, type Entity } from '../doc';
import { holderOf } from './captions';
import { OpFailure, type OpContext } from './context';
import { checked, setFrame, setLayout } from './project';
import { hasSpeaker, panelBackgroundAt, panelRegionAt, readLayout, speakerBandAt } from '../layout';
import { voiceTranscript } from './voiceover';
import {
	CLIP_MAX_SECONDS,
	CLIP_MIN_SECONDS,
	ClipSceneSchema,
	EXPLAINER_FORMATS,
	EXPLAINER_MAX_SECONDS,
	EXPLAINER_MIN_SECONDS,
	EXPLAINER_MODEL,
	ExplainerSceneSchema,
	MOTION_CLIP_MODEL,
	type ExplainerFormat,
} from '../explainer';

export * from '../explainer';

const FORMAT_KEYS = Object.keys(EXPLAINER_FORMATS) as [ExplainerFormat, ...ExplainerFormat[]];

const seed = z.number().int().min(0).max(2_147_483_647);

/**
 * The generation spec the tool priced; the op writes exactly this, so the editor finds the paid generation. A
 * narrated explainer has a voice; a silent motion clip (`motion-clip`) has none and is 3-30 s.
 */
const narratedSpec = z
	.object({
		prompt: z.string().trim().min(1).max(200),
		aspectRatio: z.enum(FORMAT_KEYS),
		duration: z.number().int().min(EXPLAINER_MIN_SECONDS).max(EXPLAINER_MAX_SECONDS),
		voice: z.string().min(1).max(100),
		seed: seed.optional(),
		scene: ExplainerSceneSchema,
	})
	.strict();
const silentSpec = z
	.object({
		prompt: z.string().trim().min(1).max(200),
		aspectRatio: z.enum(FORMAT_KEYS),
		duration: z.number().int().min(CLIP_MIN_SECONDS).max(CLIP_MAX_SECONDS),
		seed: seed.optional(),
		scene: ClipSceneSchema,
	})
	.strict();
const specInput = z.union([narratedSpec, silentSpec]);

export const explainerInput = z
	.object({
		op: z.literal('add_explainer'),
		title: z.string().trim().min(1).max(60),
		format: z.enum(FORMAT_KEYS),
		duration: z.number().int().min(CLIP_MIN_SECONDS).max(EXPLAINER_MAX_SECONDS),
		/** Clip seconds. Default: the playhead, or 0 on a blank clip. */
		start: z.number().finite().min(0).optional(),
		/**
		 * On a clip with a speaker: `top` puts the animation in the upper band and the speaker below it (a split for
		 * the animation's time), `bottom` the other way round; `left`/`right` put it in one column and the speaker in
		 * the other (16:9); `behind` fills the frame with it and puts the speaker in a corner over it (a facecam).
		 * Default: full frame, or the panel of a split already there.
		 */
		place: z.enum(['full', 'top', 'bottom', 'left', 'right', 'behind']).optional(),
		spec: specInput,
	})
	.superRefine((value, ctx) => {
		if (value.spec.aspectRatio !== value.format) ctx.addIssue({ code: 'custom', path: ['spec', 'aspectRatio'], message: 'The spec must have the same format as the explainer.' });
		if (value.spec.duration !== value.duration) ctx.addIssue({ code: 'custom', path: ['spec', 'duration'], message: 'The spec must have the same duration as the explainer.' });
	});
export type ExplainerInput = z.infer<typeof explainerInput>;

export const explainerLayerName = (title: string): string => `Explainer: ${title.trim()}`.slice(0, 80);
export const motionClipLayerName = (title: string): string => `Motion clip: ${title.trim()}`.slice(0, 80);
const silent = (input: ExplainerInput): boolean => !('voice' in input.spec);

const round = (value: number) => Math.round(value * 1000) / 1000;

/** A clip with nothing on it yet ("New edit"): the explainer IS the video, so it sets the frame. */
const isBlank = (document: ClipDocument): boolean => !(sceneOf(document)?.children ?? []).length;

export const addExplainer = {
	name: 'add_explainer',
	agent: false,
	input: explainerInput,
	describe: (input: ExplainerInput) => `Add the ${silent(input) ? 'motion clip' : 'explainer'} "${input.title}" (${input.duration}s, ${input.format})`,
	async apply(document: ClipDocument, input: ExplainerInput, ctx: OpContext) {
		const blank = isBlank(document);
		const [formatWidth, formatHeight] = EXPLAINER_FORMATS[input.format];
		let next = blank ? await setFrame.apply(document, { op: 'set_frame', width: formatWidth, height: formatHeight } as never, ctx) : clone(document);
		if (next === document) next = clone(document);
		const root = sceneOf(next);
		if (!root?.width || !root.height) throw new OpFailure('This project has no scene to edit.');

		const playhead = typeof root.playhead === 'number' ? root.playhead : 0;
		const start = round(input.start ?? (blank ? 0 : playhead));
		const end = round(start + input.duration);
		// The explainer plays whole: the visible range grows to hold it (a blank clip is exactly it).
		const workarea = root.workarea as [number, number] | undefined;
		if (blank) root.workarea = [0, end];
		else if (workarea && workarea[1] < end) root.workarea = [workarea[0], end];

		// Full frame when the format matches the clip; otherwise the largest centred box of its shape, inside the
		// visual band when the frame is split.
		let area = { x: 0, y: 0, width: root.width, height: root.height };
		const laidOut = !blank && input.place !== undefined && input.place !== 'full';
		if (laidOut && !hasSpeaker(next)) throw new OpFailure(`There is no speaker video to put next to the animation. Use place "full".`);
		if (laidOut && (input.place === 'left' || input.place === 'right') && root.width < root.height) {
			throw new OpFailure(`Columns are for a landscape frame; this ${root.width}x${root.height} frame is vertical. Use place "top" or "bottom".`);
		}
		// A panel colour the user chose for this span stays: the new layout replaces the range under it.
		const background = panelBackgroundAt(next, start) ?? undefined;
		const keep = background ? { background } : {};
		if (!blank && (input.place === 'top' || input.place === 'bottom')) {
			// The band takes the full width at the animation's own shape; the speaker gets the rest.
			const band = Math.round((root.width * formatHeight) / formatWidth);
			const ratio = round((root.height - band) / root.height);
			if (ratio < 0.3 || ratio > 0.7) {
				const fits = FORMAT_KEYS.filter((key) => {
					const [w, h] = EXPLAINER_FORMATS[key];
					const r = (root.height - (root.width * h) / w) / root.height;
					return r >= 0.3 && r <= 0.7;
				});
				throw new OpFailure(
					`A ${input.format} animation does not fit half of this ${root.width}x${root.height} frame next to the speaker. ${fits.length ? `Use format ${fits.join(' or ')}.` : 'Show it full frame.'}`,
				);
			}
			const split = await setLayout.apply(
				next,
				{ op: 'set_layout', mode: input.place === 'top' ? 'split-bottom' : 'split-top', start, end, ratio, ...keep } as never,
				ctx,
			);
			next = split;
			area = { x: 0, y: input.place === 'top' ? 0 : root.height - band, width: root.width, height: band };
		} else if (!blank && (input.place === 'left' || input.place === 'right')) {
			// The speaker takes the other column; the animation fits its column at its own shape.
			next = await setLayout.apply(next, { op: 'set_layout', mode: 'side-by-side', start, end, anchor: input.place === 'left' ? 'right' : 'left', ...keep } as never, ctx);
			const column = root.width / 2;
			area = { x: input.place === 'left' ? 0 : column, y: 0, width: column, height: root.height };
		} else if (!blank && input.place === 'behind') {
			next = await setLayout.apply(next, { op: 'set_layout', mode: 'pip', start, end, ...keep } as never, ctx);
		} else if (!blank && input.place !== 'full') {
			// A layout already on screen: the animation fills its visual area, not the whole frame over the speaker.
			const ranges = readLayout(next);
			const range = ranges.find((item) => start >= item.start - 1e-6 && start < item.end);
			if (range && range.mode !== 'cell' && range.mode !== 'visual-only') {
				// The layout holds for the whole animation (up to the next layout), or the speaker would come back full
				// frame under a half-size animation.
				const stop = Math.min(end, ranges.find((item) => item.start >= range.end - 1e-6)?.start ?? end);
				if (stop > range.end + 1e-6) {
					const { mode, ratio, anchor, background: colour } = range;
					next = await setLayout.apply(next, { op: 'set_layout', mode, start: range.start, end: stop, ratio, ...(anchor ? { anchor } : {}), ...(colour ? { background: colour } : {}) } as never, ctx);
				}
				const speaker = speakerBandAt(next, start);
				const region = panelRegionAt(next, start);
				if (speaker) {
					const top = speaker.y > 0 ? 0 : Math.round(speaker.height * root.height);
					area = { x: 0, y: top, width: root.width, height: Math.round((1 - speaker.height) * root.height) };
				} else if (region) {
					area = { x: region.x * root.width, y: region.y * root.height, width: region.width * root.width, height: region.height * root.height };
				}
			}
		}
		const scene = sceneOf(next)!;
		const scale = Math.min(area.width / formatWidth, area.height / formatHeight);
		const width = Math.round(formatWidth * scale);
		const height = Math.round(formatHeight * scale);
		const src: AssetDeclaration = {
			generate: 'video',
			prompt: input.spec.prompt,
			// No voice, no captions to follow: `sync_explainer` and the editor caption only EXPLAINER_MODEL layers.
			model: 'voice' in input.spec ? EXPLAINER_MODEL : MOTION_CLIP_MODEL,
			aspectRatio: input.spec.aspectRatio,
			duration: input.spec.duration,
			...('voice' in input.spec ? { voice: input.spec.voice } : {}),
			scene: input.spec.scene as Record<string, unknown>,
			...(input.spec.seed === undefined ? {} : { seed: input.spec.seed }),
		};
		// Under captions and text like every generated media: they stay readable on top. Behind a facecam it goes
		// under the speaker's cell instead, or it would cover the speaker.
		const children = [...(scene.children ?? [])];
		const speakerAt = children.findIndex((child) => (child as { marks?: { layout?: string } }).marks?.layout === 'speaker');
		const at = input.place === 'behind' && speakerAt >= 0 ? speakerAt : children.findIndex((child) => child.kind === 'captions' || child.kind === 'text');
		children.splice(at < 0 ? children.length : at, 0, {
			kind: 'rect',
			name: silent(input) ? motionClipLayerName(input.title) : explainerLayerName(input.title),
			keepAspectRatio: true,
			x: Math.round(area.x + (area.width - width) / 2),
			y: Math.round(area.y + (area.height - height) / 2),
			width,
			height,
			start,
			end,
			paints: [{ type: 'video', src }],
		} as never);
		scene.children = children;
		return checked(next, 'That explainer cannot be added');
	},
};

// ---------------------------------------------------------------------------
// The voice's words arrived with the render

const wordSchema = z.object({ text: z.string().max(200), start: z.number().finite().min(0), end: z.number().finite().min(0) });

export const syncExplainerInput = z.object({
	op: z.literal('sync_explainer'),
	element_id: z.string().min(1).max(64),
	words: z.array(wordSchema).max(20000).optional(),
});
type SyncExplainer = z.infer<typeof syncExplainerInput>;

/** The explainer declaration a layer plays, if it plays one. */
function explainerSrc(element: Entity): Record<string, unknown> | null {
	for (const paint of (element.paints as Entity[] | undefined) ?? []) {
		const src = paint.type === 'video' ? (paint.src as Record<string, unknown> | undefined) : undefined;
		if (src && typeof src === 'object' && src.model === EXPLAINER_MODEL) return src;
	}
	return null;
}

/** Title for the captions layer: the scene's title, else the layer name without its prefix. */
function titleOf(element: Entity, src: Record<string, unknown>): string {
	const scene = src.scene as { title?: unknown } | undefined;
	if (typeof scene?.title === 'string' && scene.title.trim()) return scene.title.trim();
	const name = typeof element.name === 'string' ? element.name.replace(/^Explainer:\s*/, '').trim() : '';
	return name || 'Explainer';
}

/**
 * Captions of an explainer's narration, from the word timings that come back with its generation
 * (`docs/explainer-v2-build.md`, op `sync_explainer`). The editor runs it when the render lands:
 * one visible captions layer timed like the explainer layer, `source` = that layer (the own-video
 * convention, so cut-by-words tools read it). A layer that already has its captions only gets the
 * new transcript. No words (the fake voice) → no change. `agent: false`: the words live on the
 * generation row, which only the editor reads.
 */
export const syncExplainer = {
	name: 'sync_explainer',
	agent: false,
	input: syncExplainerInput,
	describe: () => 'Add captions from the explainer',
	async apply(document: ClipDocument, input: SyncExplainer, ctx: OpContext) {
		if (!input.words?.some((word) => word.text.trim())) return document;
		const next = clone(document);
		const found = holderOf(next, input.element_id);
		const src = found ? explainerSrc(found.element) : null;
		if (!found || !src) throw new OpFailure(`No explainer with id "${input.element_id}".`);
		const transcript = voiceTranscript(input.words);
		const existing: Entity[] = [];
		walk(next, ({ entity }) => {
			if (entity.kind === 'captions' && entity.source === input.element_id) existing.push(entity);
		});
		const path = await ctx.saveTranscript(transcript);
		const element = found.element;
		const start = round(typeof element.start === 'number' ? element.start : 0);
		const end = typeof element.end === 'number' ? round(element.end) : undefined;
		if (existing.length) {
			if (existing.every((entity) => entity.src === path)) return document;
			for (const entity of existing) entity.src = path;
			return checked(next, 'Those captions cannot be added');
		}
		const style = readCaptionStyle(next);
		const captions: Entity = {
			kind: 'captions',
			name: `Captions · ${titleOf(element, src)}`.slice(0, 80),
			src: path,
			source: input.element_id,
			...(style?.preset ? { preset: style.preset } : {}),
			...(style?.colors?.length ? { colors: style.colors } : {}),
			...(style?.color ? { color: style.color } : {}),
			...(style?.fontFamily ? { fontFamily: style.fontFamily } : {}),
			...(style?.fontWeight ? { fontWeight: style.fontWeight } : {}),
			start,
			...(end === undefined ? {} : { end }),
		};
		((found.holder.children as Entity[] | undefined) ??= []).push(captions);
		return checked(next, 'Those captions cannot be added');
	},
};
