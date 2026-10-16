import { describe, expect, it } from 'vitest';

import { CAPABILITIES, capabilityIssues, missingCapabilities } from './capabilities';
import { OP_NAMES } from './ops';

describe('capability registry', () => {
	it('every ready capability names ops the registry has', () => {
		expect(capabilityIssues(OP_NAMES)).toEqual([]);
	});

	it('a ready capability with a missing op is reported', () => {
		const registry = { ...CAPABILITIES, 'title.hook': { track: 'B', ready: true, ops: ['add_hook_title'] } } as const;
		expect(capabilityIssues(OP_NAMES.filter((name) => name !== 'add_hook_title'), registry)).toEqual([
			'title.hook is ready but its ops are not in the registry: add_hook_title.',
		]);
	});

	it('missing capabilities keep their order; unknown ids are never ready', () => {
		expect(missingCapabilities(['layout.split', 'title.hook', 'nope'], { ...CAPABILITIES, 'title.hook': { track: 'B', ready: false, ops: [] } })).toEqual(['title.hook', 'nope']);
	});

	it('apply_style is an op the Assistant can call', () => {
		expect(OP_NAMES).toContain('apply_style');
	});
});
