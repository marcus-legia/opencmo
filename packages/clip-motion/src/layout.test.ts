import { describe, expect, it } from 'vitest';

import { layoutIssues, type LaidBox } from './layout.ts';

const frame = { width: 1920, height: 1080, seconds: 4 };
const visual: LaidBox = { kind: 'mark', name: 'DotField', x: 200, y: 200, w: 1500, h: 600 };

describe('layoutIssues', () => {
	it('passes a well-placed frame', () => {
		expect(layoutIssues([visual, { kind: 'text', name: 'Brightest peaks', x: 800, y: 90, w: 320, h: 60, size: 52 }], frame)).toEqual([]);
	});

	it('reports text over text', () => {
		const a: LaidBox = { kind: 'text', name: 'One', x: 800, y: 100, w: 300, h: 60, size: 52 };
		const b: LaidBox = { ...a, name: 'Two', x: 850 };
		expect(layoutIssues([visual, a, b], frame)).toEqual(['Text "One" overlaps text "Two" at 4.0 s.']);
	});

	it('reports the caption zone and the edges', () => {
		const low: LaidBox = { kind: 'text', name: 'Low', x: 800, y: 900, w: 300, h: 60, size: 52 };
		expect(layoutIssues([visual, low], frame)).toEqual(['Text "Low" leaves the safe area on the bottom (the caption zone) at 4.0 s.']);
	});

	it('reports small text, scaled to the short side', () => {
		const small: LaidBox = { kind: 'text', name: 'tiny', x: 800, y: 100, w: 100, h: 30, size: 24 };
		expect(layoutIssues([visual, small], frame)[0]).toContain('24 px, under the 36 px minimum');
	});

	it('reports a mostly empty frame', () => {
		expect(layoutIssues([{ kind: 'text', name: 'Alone', x: 800, y: 400, w: 300, h: 60, size: 52 }], frame)).toEqual(['The frame is more than 85% empty at 4.0 s: grow or add the visual.']);
	});
});
