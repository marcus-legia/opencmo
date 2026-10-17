import { describe, expect, it } from 'vitest';

import { CAPABILITY_IDS } from '@opencmo/editor-core/capabilities';
import { StylePresetSchema } from '@opencmo/editor-core/style';

import { SkillFrontmatterSchema } from './format';
import { ALL_SKILLS, STYLES, skillByName, styleByName } from './index';

const STYLE = {
	name: 'senior-dev-listicle',
	kind: 'style',
	description: 'Talking head with on-screen proof.',
	requires: ['caption.emphasis', 'title.hook'],
	preset: { captions: { preset: 'spotlight', maxWords: 2 } },
};

describe('skill frontmatter', () => {
	it('a style parses; requires default to none', () => {
		expect(SkillFrontmatterSchema.parse(STYLE)).toEqual(STYLE);
		expect(SkillFrontmatterSchema.parse({ name: 'x', kind: 'guide', description: 'y' }).requires).toEqual([]);
	});

	it('rejects unknown capabilities, bad presets, presets outside styles and unknown keys', () => {
		expect(SkillFrontmatterSchema.safeParse({ ...STYLE, requires: ['caption.sparkle'] }).success).toBe(false);
		expect(SkillFrontmatterSchema.safeParse({ ...STYLE, requires: ['title.hook', 'title.hook'] }).success).toBe(false);
		expect(SkillFrontmatterSchema.safeParse({ ...STYLE, preset: { captions: { maxWords: 9 } } }).success).toBe(false);
		expect(SkillFrontmatterSchema.safeParse({ ...STYLE, kind: 'playbook' }).success).toBe(false);
		expect(SkillFrontmatterSchema.safeParse({ ...STYLE, agents: ['cmo'] }).success).toBe(false);
		expect(SkillFrontmatterSchema.safeParse({ ...STYLE, name: 'Senior Dev' }).success).toBe(false);
	});
});

describe('the library', () => {
	it('names are unique; every style has a valid preset and known capabilities', () => {
		expect(new Set(ALL_SKILLS.map((skill) => skill.name)).size).toBe(ALL_SKILLS.length);
		for (const style of STYLES) {
			expect(StylePresetSchema.safeParse(style.preset ?? {}).success).toBe(true);
			for (const id of style.requires) expect(CAPABILITY_IDS).toContain(id);
		}
	});

	it('finds skills by name, case-insensitively; styleByName only finds styles', () => {
		expect(skillByName(' Senior-Dev-Listicle ')?.name).toBe('senior-dev-listicle');
		expect(styleByName('senior-dev-listicle')?.kind).toBe('style');
		expect(styleByName('nope')).toBeNull();
	});
});
