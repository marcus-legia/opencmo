/**
 * `npm run skills:gaps`: what each style still waits for. The list is the backlog of the capability
 * registry — a style goes live in the Assistant only when every capability it requires is ready.
 */

import { CAPABILITIES, missingCapabilities, type Capability } from '@opencmo/editor-core/capabilities';

import { ALL_SKILLS } from '../src/index.ts';

let waiting = 0;
for (const skill of ALL_SKILLS) {
	const missing = missingCapabilities(skill.requires);
	if (!missing.length) {
		console.log(`✓ ${skill.kind} ${skill.name}: ready`);
		continue;
	}
	waiting += 1;
	console.log(`✗ ${skill.kind} ${skill.name} waits for:`);
	for (const id of missing) {
		const info = CAPABILITIES[id as Capability];
		console.log(`    ${id}${info ? ` (Track ${info.track}${info.ops.length ? `: ${info.ops.join(', ')}` : ''})` : ' (unknown capability)'}`);
	}
}
console.log(`\n${ALL_SKILLS.length - waiting} of ${ALL_SKILLS.length} skills ready.`);
