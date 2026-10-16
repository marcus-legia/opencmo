/**
 * The machine-applied half of a style skill (`preset` in its frontmatter). The judgment half — which
 * words, which hook, which proof — is the skill's body, applied by the Assistant through an Edit Plan.
 *
 * Every key is optional: a style says only what it pins. `accent`/`brand` resolve to the clip's brand
 * kit accent when the style is applied.
 */

import { z } from 'zod';

import { CAPTION_PRESETS, TRANSITION_TYPES } from '@opencmo/clip-doc';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colors are hex, like #FFD400.');
const colorRef = z.union([hex, z.enum(['accent', 'ink', 'paper'])]);
const fontStyle = z.enum(['normal', 'italic']);

/**
 * Transitions a style may ask for. `whip` is listed before the document schema has it (Track B adds
 * it to `TRANSITION_TYPES`); until then `apply_style` reports `transition.whip` as unavailable.
 */
export const STYLE_TRANSITIONS = [...new Set([...TRANSITION_TYPES, 'whip'])] as [string, ...string[]];

export const StylePresetSchema = z
	.object({
		captions: z
			.object({
				preset: z.enum(CAPTION_PRESETS).optional(),
				maxWords: z.number().int().min(1).max(6).optional(),
				highlight: z.enum(['block', 'pop']).nullable().optional(),
				reveal: z.enum(['fade']).optional(),
				emphasis: z
					.object({
						fontFamily: z.string().optional(),
						fontStyle: fontStyle.optional(),
						color: colorRef.optional(),
						scale: z.number().min(1).max(1.6).optional(),
					})
					.strict()
					.optional(),
			})
			.strict()
			.optional(),
		hookTitle: z
			.object({
				accentLine: z.union([z.literal(1), z.literal(2)]).optional(),
				accentBox: z.boolean().optional(),
				fontFamily: z.string().optional(),
				accentFontFamily: z.string().optional(),
				accentFontStyle: fontStyle.optional(),
				seconds: z.number().min(1).max(8).optional(),
			})
			.strict()
			.optional(),
		speaker: z
			.object({
				punchIn: z
					.object({
						scales: z.tuple([z.number().min(1).max(1.5), z.number().min(1).max(1.5)]),
						minShot: z.number().min(0.3).max(10),
					})
					.strict()
					.optional(),
			})
			.strict()
			.optional(),
		chapters: z.object({ transition: z.enum(STYLE_TRANSITIONS).optional() }).strict().optional(),
		proof: z
			.object({ zoom: z.number().min(1).max(3).optional(), mark: z.enum(['marker', 'box']).optional() })
			.strict()
			.optional(),
		palette: z
			.object({ accent: z.union([hex, z.literal('brand')]).optional(), paper: hex.optional(), ink: hex.optional() })
			.strict()
			.optional(),
	})
	.strict();

export type StylePreset = z.infer<typeof StylePresetSchema>;
