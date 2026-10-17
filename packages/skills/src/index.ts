/**
 * The skill library: styles (and later playbooks and guides) as data. Markdown files under
 * `styles/` are compiled into `index.gen.ts` by `scripts/build-skills.mts`; this module only reads
 * the generated data, so the runtime never parses YAML or touches the file system.
 *
 * Whether a style can be offered depends on the capability registry in editor-core; that check
 * lives with the registry (`missingCapabilities`), not here, so this package stays plain data.
 */

import { SKILLS } from './index.gen';

export type Skill = {
	name: string;
	kind: 'style' | 'playbook' | 'guide';
	description: string;
	requires: readonly string[];
	preset?: Readonly<Record<string, unknown>>;
	body: string;
};

export const ALL_SKILLS: readonly Skill[] = SKILLS as readonly Skill[];

export const STYLES: readonly Skill[] = ALL_SKILLS.filter((skill) => skill.kind === 'style');

export function skillByName(name: string): Skill | null {
	const key = name.trim().toLowerCase();
	return ALL_SKILLS.find((skill) => skill.name === key) ?? null;
}

export function styleByName(name: string): Skill | null {
	const skill = skillByName(name);
	return skill?.kind === 'style' ? skill : null;
}
