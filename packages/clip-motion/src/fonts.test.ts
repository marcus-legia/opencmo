import { describe, expect, it } from 'vitest';

import { fontsFor, LIBRARY, ROLES } from './remotion/fonts.ts';

describe('fontsFor', () => {
	it('loads the roles and the fonts the scene names, not the whole library', () => {
		const names = fontsFor(`return () => <Type font="Lora" text="Hi" />;`);
		expect(new Set(names)).toEqual(new Set([...Object.values(ROLES), 'Lora']));
	});

	it('loads every font when the scene picks one by a computed key', () => {
		expect(fontsFor('const f = kit.font[pick];')).toHaveLength(Object.keys(LIBRARY).length);
		expect(fontsFor('Object.keys(kit.fonts)')).toHaveLength(Object.keys(LIBRARY).length);
		expect(fontsFor(undefined)).toHaveLength(Object.keys(LIBRARY).length);
	});
});
