/**
 * Frontmatter of a skill file (`packages/skills/<kind>s/<name>.md`), checked by the build script.
 *
 * A skill is data: `requires` names capabilities from the editor-core registry, `preset` (styles
 * only) holds values the machine applies, and the markdown body holds the judgment the model applies.
 * Only the build script imports this file; the runtime reads the generated index.
 */

import { z } from 'zod';

import { CAPABILITY_IDS } from '@opencmo/editor-core/capabilities';
import { StylePresetSchema } from '@opencmo/editor-core/style';

export const SKILL_KINDS = ['style', 'playbook', 'guide'] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

/** Folder of each kind under `packages/skills`. */
export const KIND_DIRS: Record<SkillKind, string> = { style: 'styles', playbook: 'playbooks', guide: 'guides' };

/** The body is read into the model's context in one tool call; keep it short enough to follow. */
export const MAX_BODY_CHARS = 12_000;

export const SkillFrontmatterSchema = z
	.object({
		name: z
			.string()
			.min(1)
			.max(64)
			.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Names are kebab-case, like senior-dev-listicle.'),
		kind: z.enum(SKILL_KINDS),
		/** When to use it: one line, shown in the Assistant's index. */
		description: z.string().trim().min(1).max(300),
		requires: z.array(z.enum(CAPABILITY_IDS)).max(20).default([]),
		preset: StylePresetSchema.optional(),
	})
	.strict()
	.superRefine((skill, ctx) => {
		if (skill.preset && skill.kind !== 'style') ctx.addIssue({ code: 'custom', path: ['preset'], message: 'Only a style has a preset.' });
		if (new Set(skill.requires).size !== skill.requires.length) ctx.addIssue({ code: 'custom', path: ['requires'], message: 'A capability is listed twice.' });
	});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
