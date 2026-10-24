/**
 * Numeric promises a scene makes about its own layout (kit.audit), checked by the preview on every measured frame,
 * after the spatial audits of Opus's remakes (spatial-audit.json): the model states the clearance it designed for and
 * the preview says where it does not hold.
 */

import { kitError } from './context.tsx';

export type AuditCheck =
	| { kind: 'clear'; a: string; b: string; px: number }
	| { kind: 'inside'; name: string; box: { x: number; y: number; w: number; h: number }; label: string };

const registry = new WeakMap<object, AuditCheck[]>();

export function makeAudit(owner: object, area: (name: 'full' | 'hero' | 'left' | 'right' | 'top' | 'bottom') => { x: number; y: number; w: number; h: number }) {
	const checks: AuditCheck[] = [];
	registry.set(owner, checks);
	const add = (check: AuditCheck) => {
		const key = JSON.stringify(check);
		if (!checks.some((item) => JSON.stringify(item) === key)) {
			if (checks.length >= 24) throw kitError('kit.audit: at most 24 checks per scene.');
			checks.push(check);
		}
	};
	return Object.freeze({
		/** The boxes named `a` and `b` stay at least `px` apart whenever both are on screen. */
		clear(a: string, b: string, px = 0) {
			if (typeof a !== 'string' || typeof b !== 'string' || !Number.isFinite(px) || px < 0) throw kitError('kit.audit.clear(nameA, nameB, px).');
			add({ kind: 'clear', a, b, px });
		},
		/** The box named `name` stays inside an area name (full, hero, left, right, top, bottom) or a box. */
		inside(name: string, target: string | { x: number; y: number; w: number; h: number }) {
			if (typeof name !== 'string') throw kitError('kit.audit.inside(name, area).');
			const box = typeof target === 'string' ? area(target as 'full') : target;
			if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) throw kitError('kit.audit.inside: the area is a name or a box { x, y, w, h }.');
			add({ kind: 'inside', name, box: { x: box.x, y: box.y, w: box.w, h: box.h }, label: typeof target === 'string' ? target : `${Math.round(box.w)}×${Math.round(box.h)} box` });
		},
	});
}

export function auditChecks(owner: object): AuditCheck[] {
	return registry.get(owner) ?? [];
}
