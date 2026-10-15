import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { iconsFile } from '../assets.ts';
import { closestIcons, iconPath, setIconLibrary, V1_ICONS } from './icons.ts';

describe('icons', () => {
	beforeAll(() => setIconLibrary(JSON.parse(readFileSync(iconsFile(), 'utf8'))));

	it('finds subject icons of the Lucide set', () => {
		for (const name of ['virus', 'syringe', 'shield-check', 'dna', 'microscope']) expect(iconPath(name)).toMatch(/^M/);
	});

	it('keeps the v1 drawings for v1 names', () => {
		expect(iconPath('database')).toBe(V1_ICONS.database);
		expect(iconPath('wave')).toBe(V1_ICONS.wave);
	});

	it('suggests the closest names for a misspelt one', () => {
		expect(iconPath('virsu')).toBeNull();
		expect(closestIcons('virsu')).toContain('virus');
		expect(closestIcons('shield')[0]).toBe('shield');
	});
});
