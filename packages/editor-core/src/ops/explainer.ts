/**
 * `add_explainer`: places a finished explainer (Remotion animation + narration, rendered on the
 * worker by `packages/clip-motion`) as ONE full-frame generated video layer. The op only writes the
 * `generate.video` declaration of model `motion-explainer`; the editor resolves it through
 * `/api/v1/generations` like any generation, and the layer shows render progress until the MP4 lands.
 *
 * `agent: false`: it costs credits, so the Assistant reaches it only through `add_explainer` (the
 * tool), whose price card the user approves first.
 */

import { z } from 'zod';

import type { AssetDeclaration, ClipDocument } from '@opencmo/clip-doc';

import { clone, sceneOf } from '../doc';
import { OpFailure, type OpContext } from './context';
import { checked, setFrame } from './project';
import {
	EXPLAINER_FORMATS,
	EXPLAINER_MAX_SECONDS,
	EXPLAINER_MIN_SECONDS,
	EXPLAINER_MODEL,
	ExplainerSceneSchema,
	type ExplainerFormat,
} from '../explainer';

export * from '../explainer';

const FORMAT_KEYS = Object.keys(EXPLAINER_FORMATS) as [ExplainerFormat, ...ExplainerFormat[]];

const seed = z.number().int().min(0).max(2_147_483_647);

/** The generation spec the tool priced; the op writes exactly this, so the editor finds the paid generation. */
const specInput = z
	.object({
		prompt: z.string().trim().min(1).max(200),
		aspectRatio: z.enum(FORMAT_KEYS),
		duration: z.number().int().min(EXPLAINER_MIN_SECONDS).max(EXPLAINER_MAX_SECONDS),
		voice: z.string().min(1).max(100),
		seed: seed.optional(),
		scene: ExplainerSceneSchema,
	})
	.strict();

export const explainerInput = z
	.object({
		op: z.literal('add_explainer'),
		title: z.string().trim().min(1).max(60),
		format: z.enum(FORMAT_KEYS),
		duration: z.number().int().min(EXPLAINER_MIN_SECONDS).max(EXPLAINER_MAX_SECONDS),
		/** Clip seconds. Default: the playhead, or 0 on a blank clip. */
		start: z.number().finite().min(0).optional(),
		spec: specInput,
	})
	.superRefine((value, ctx) => {
		if (value.spec.aspectRatio !== value.format) ctx.addIssue({ code: 'custom', path: ['spec', 'aspectRatio'], message: 'The spec must have the same format as the explainer.' });
		if (value.spec.duration !== value.duration) ctx.addIssue({ code: 'custom', path: ['spec', 'duration'], message: 'The spec must have the same duration as the explainer.' });
	});
export type ExplainerInput = z.infer<typeof explainerInput>;

export const explainerLayerName = (title: string): string => `Explainer: ${title.trim()}`.slice(0, 80);

const round = (value: number) => Math.round(value * 1000) / 1000;

/** A clip with nothing on it yet ("New edit"): the explainer IS the video, so it sets the frame. */
const isBlank = (document: ClipDocument): boolean => !(sceneOf(document)?.children ?? []).length;

export const addExplainer = {
	name: 'add_explainer',
	agent: false,
	input: explainerInput,
	describe: (input: ExplainerInput) => `Add the explainer "${input.title}" (${input.duration}s, ${input.format})`,
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

		// Full frame when the format matches the clip; otherwise the largest centred box of its shape.
		const scale = Math.min(root.width / formatWidth, root.height / formatHeight);
		const width = Math.round(formatWidth * scale);
		const height = Math.round(formatHeight * scale);
		const src: AssetDeclaration = {
			generate: 'video',
			prompt: input.spec.prompt,
			model: EXPLAINER_MODEL,
			aspectRatio: input.spec.aspectRatio,
			duration: input.spec.duration,
			voice: input.spec.voice,
			scene: input.spec.scene as Record<string, unknown>,
			...(input.spec.seed === undefined ? {} : { seed: input.spec.seed }),
		};
		// Under captions and text like every generated media: they stay readable on top.
		const children = [...(root.children ?? [])];
		const at = children.findIndex((child) => child.kind === 'captions' || child.kind === 'text');
		children.splice(at < 0 ? children.length : at, 0, {
			kind: 'rect',
			name: explainerLayerName(input.title),
			keepAspectRatio: true,
			x: Math.round((root.width - width) / 2),
			y: Math.round((root.height - height) / 2),
			width,
			height,
			start,
			end,
			paints: [{ type: 'video', src }],
		} as never);
		root.children = children;
		return checked(next, 'That explainer cannot be added');
	},
};
