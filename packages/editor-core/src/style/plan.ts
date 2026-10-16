/**
 * The Edit Plan: what the Assistant writes after reading a style, in one structured step.
 *
 * Every beat anchors to exact words of the transcript, never to seconds: a model quotes well and
 * times badly. `apply_style` resolves the quotes with the same rules as every quote-placed op, and a
 * quote it cannot find becomes a skipped item in the receipt, never a guess.
 */

import { z } from 'zod';

export const EditPlanSchema = z
	.object({
		/** The style skill's name. */
		style: z.string(),
		hook: z.object({ lines: z.array(z.string().trim().min(1).max(40)).min(1).max(2) }).strict().optional(),
		emphasis: z.array(z.object({ quote: z.string().min(1).max(60) }).strict()).max(40).default([]),
		chapters: z
			.array(z.object({ quote: z.string().min(1).max(200), title: z.string().max(40).optional() }).strict())
			.max(10)
			.default([]),
		list: z
			.object({
				/** When the list appears. */
				quote: z.string(),
				items: z
					.array(z.object({ label: z.string().max(40), meta: z.string().max(16).optional(), blur: z.boolean().optional() }).strict())
					.min(2)
					.max(7),
				/** One per item, in order: the words that light the item up. */
				reveal: z.array(z.object({ quote: z.string() }).strict()).max(7).optional(),
			})
			.strict()
			.optional(),
		proofs: z
			.array(
				z
					.object({
						/** A finished page capture (`capture_page`). */
						capture_id: z.string(),
						/** When the card shows. */
						quote: z.string().min(1).max(200),
						/** Text on the captured page to zoom to and mark. */
						focus: z.string().min(1).max(120),
					})
					.strict(),
			)
			.max(6)
			.default([]),
	})
	.strict();

export type EditPlan = z.infer<typeof EditPlanSchema>;
/** What a caller writes: the defaulted arrays may be left out. */
export type EditPlanInput = z.input<typeof EditPlanSchema>;
