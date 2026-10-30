/**
 * Slide ops (P5 B0, contract; B1 adds `apply` and the registry entries): a slideshow is a document of timed
 * slides on one timeline, not a second editor (`docs/architecture/studio.md` §7).
 *
 * Document shape, with no `clip-doc` schema change:
 * - A slide is a group directly under the scene with `start` and `end`, marked `marks.visual = { op: 'add_slide',
 *   input }` (`slideSpans` in `clip-doc` finds them). Slides touch: the first starts at 0, each next where the last ends.
 * - Its children are `Background` (a rect, or an image for `{src}`), `Heading` and `Body` (text layers, never text
 *   inside an image), timed from the group's start. A child with no `end` would stop at the renderer's default length,
 *   so each carries `start: 0` and `end` = the slide's duration.
 * - The group is the truth. Each slide also has one marker in the scene's `marks.markers`, for navigation; every slide
 *   op rebuilds them, so a deleted marker comes back and none can drift.
 *
 * Colour and image changes after `add_slide` go through `set_props` and `replace_src` on `Background`.
 */

import { z } from 'zod';

/** TikTok photo mode's limit: the PNG set must fit it. */
export const MAX_SLIDES = 35;
export const SLIDE_SECONDS = { min: 1, max: 30, default: 4 } as const;
export const SLIDE_LAYERS = { background: 'Background', heading: 'Heading', body: 'Body' } as const;

const slideId = z.string().min(1).max(40);
const heading = z.string().trim().min(1).max(200);
const body = z.string().trim().max(600);
const seconds = z.number().finite().min(SLIDE_SECONDS.min).max(SLIDE_SECONDS.max);

export const slideBackground = z.union([
	z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colors are hex, like #FFD400.') }).strict(),
	z.object({ src: z.string().min(1).max(500) }).strict(),
]);

export const addSlideInput = z.object({
	op: z.literal('add_slide'),
	after: slideId.optional().describe('The slide this one follows. Omit to add it at the end.'),
	heading,
	body: body.optional(),
	duration: seconds.optional().describe(`Seconds on screen, ${SLIDE_SECONDS.default} by default.`),
	background: slideBackground.optional().describe('A hex colour or a library image. Omit for the Brand Kit background.'),
});

export const moveSlideInput = z.object({
	op: z.literal('move_slide'),
	slide_id: slideId,
	to: z.number().int().min(0).max(MAX_SLIDES - 1).describe('Its new position; 0 is the first slide.'),
});

export const deleteSlideInput = z.object({ op: z.literal('delete_slide'), slide_id: slideId });

export const setSlideDurationInput = z.object({ op: z.literal('set_slide_duration'), slide_id: slideId, seconds });

export const setSlideTextInput = z
	.object({
		op: z.literal('set_slide_text'),
		slide_id: slideId,
		heading: heading.optional(),
		body: body.optional().describe('An empty string removes the body.'),
	})
	.refine((input) => input.heading !== undefined || input.body !== undefined, 'Give the heading, the body or both.');

export type AddSlide = z.infer<typeof addSlideInput>;
export type MoveSlide = z.infer<typeof moveSlideInput>;
export type DeleteSlide = z.infer<typeof deleteSlideInput>;
export type SetSlideDuration = z.infer<typeof setSlideDurationInput>;
export type SetSlideText = z.infer<typeof setSlideTextInput>;
