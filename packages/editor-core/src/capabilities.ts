/**
 * Capability registry (docs/style-skills-build.md): every building block a style skill can ask for,
 * the ops behind it, and whether it works today.
 *
 * Styles are data that name capabilities in `requires`; a style whose requires are not all ready is
 * hidden from the Assistant, and `apply_style` skips the parts of a plan whose capability is not
 * ready. That keeps "don't ship coming soon" mechanical: flipping `ready` is the only way a recipe
 * goes live, and `npm run skills:gaps` prints what each style still waits for.
 *
 * Each track flips only its own lines (`track`). `capabilityIssues` (run by the capability check and
 * the tests) fails when a ready capability names an op the registry does not have.
 */

export type CapabilityInfo = {
	/** The track of the build plan that owns the line. */
	track: 'A' | 'B' | 'C';
	ready: boolean;
	/** Ops (editor-core registry names) the capability writes through. Empty for tools outside the registry. */
	ops: readonly string[];
};

export const CAPABILITIES = {
	'caption.emphasis': { track: 'B', ready: true, ops: ['emphasize_words'] },
	'caption.reveal': { track: 'B', ready: true, ops: ['set_props'] },
	'title.hook': { track: 'B', ready: true, ops: ['add_hook_title'] },
	'speaker.punchIn': { track: 'B', ready: true, ops: ['punch_in'] },
	'list.reveal': { track: 'B', ready: false, ops: ['add_list'] },
	// The transition sits on the left clip of a cut.
	'transition.whip': { track: 'B', ready: false, ops: ['set_props'] },
	'layout.split': { track: 'B', ready: true, ops: ['set_layout'] },
	// The Assistant's `capture_page` tool; no document op.
	'proof.capture': { track: 'C', ready: false, ops: [] },
	'proof.card': { track: 'C', ready: false, ops: ['add_proof'] },
} as const satisfies Record<string, CapabilityInfo>;

export type Capability = keyof typeof CAPABILITIES;

export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as [Capability, ...Capability[]];

export const isCapability = (id: string): id is Capability => Object.hasOwn(CAPABILITIES, id);

/** Whether a capability works today. Unknown ids are never ready. */
export function isReady(id: string, registry: Readonly<Record<string, CapabilityInfo>> = CAPABILITIES): boolean {
	return Object.hasOwn(registry, id) && registry[id]!.ready;
}

/** The capabilities of `requires` that are not ready yet, in the order given. */
export function missingCapabilities(requires: readonly string[], registry: Readonly<Record<string, CapabilityInfo>> = CAPABILITIES): string[] {
	return requires.filter((id) => !isReady(id, registry));
}

/**
 * Problems with the registry against the op names the editor-core registry really has: a ready
 * capability must not name an op that does not exist. A capability that is not ready may name an op
 * that is still being built — that is the backlog.
 */
export function capabilityIssues(opNames: readonly string[], registry: Readonly<Record<string, CapabilityInfo>> = CAPABILITIES): string[] {
	const known = new Set(opNames);
	const issues: string[] = [];
	for (const [id, info] of Object.entries(registry)) {
		const missing = info.ops.filter((op) => !known.has(op));
		if (info.ready && missing.length) issues.push(`${id} is ready but its ops are not in the registry: ${missing.join(', ')}.`);
	}
	return issues;
}
