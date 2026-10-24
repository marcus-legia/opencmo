import { describe, expect, it } from 'vitest';

import { beatIssues, jumpIssues, layoutIssues, type LaidBox } from './layout.ts';

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

describe('layoutIssues for a silent clip', () => {
	it('lets marks cross the edges and the field stay empty, but not text', () => {
		const phone: LaidBox = { kind: 'mark', name: 'Phone', x: -60, y: 200, w: 300, h: 640 };
		expect(layoutIssues([phone], frame, { clip: true })).toEqual([]);
		const low: LaidBox = { kind: 'text', name: 'Low', x: 800, y: 900, w: 300, h: 60, size: 52 };
		expect(layoutIssues([phone, low], frame, { clip: true })).toEqual(['Text "Low" leaves the safe area on the bottom (the caption zone) at 4.0 s.']);
		expect(layoutIssues([phone], frame).length).toBeGreaterThan(0);
	});
});

describe('beatIssues', () => {
	const icon: LaidBox = { kind: 'mark', name: 'Icon virus', x: 800, y: 400, w: 200, h: 200 };
	const label: LaidBox = { kind: 'text', name: 'A harmless piece', x: 800, y: 90, w: 320, h: 60, size: 52 };

	it('passes a beat with a picture that moves', () => {
		expect(beatIssues([{ beat: 0, boxes: [label, icon] }, { beat: 0, boxes: [label, { ...icon, x: 900 }] }])).toEqual([]);
	});

	it('reports a beat with text only (a board is not a picture)', () => {
		const board: LaidBox = { kind: 'mark', name: 'Board', x: 100, y: 300, w: 800, h: 300 };
		expect(beatIssues([{ beat: 2, boxes: [label, board] }])).toEqual(['Beat 3 shows nothing drawn: draw what its narration names (a Mark you draw, a shape, an icon).']);
	});

	it('reports a beat where nothing moves, but not a Lottie or a dot field', () => {
		expect(beatIssues([{ beat: 1, boxes: [label, icon] }, { beat: 1, boxes: [label, icon] }])).toEqual(['Nothing moves during beat 2: add a change (a swap, a move, a reaction) or an ambient layer.']);
		const lottie: LaidBox = { kind: 'mark', name: 'Lottie walk', x: 800, y: 400, w: 300, h: 300 };
		expect(beatIssues([{ beat: 1, boxes: [lottie] }, { beat: 1, boxes: [lottie] }])).toEqual([]);
	});

	it('counts a Mark as a picture that moves inside its box', () => {
		const mark: LaidBox = { kind: 'mark', name: 'Mark disc', x: 0, y: 0, w: 100, h: 100 };
		expect(beatIssues([{ beat: 0, boxes: [mark] }, { beat: 0, boxes: [mark] }])).toEqual([]);
	});
});

describe('jumpIssues', () => {
	const size = { width: 1920, height: 1080 };
	const icon: LaidBox = { kind: 'mark', name: 'Icon rocket', x: 400, y: 400, w: 200, h: 200 };

	it('reports a box that moves 300 px in one frame on a 1080 frame', () => {
		expect(jumpIssues([{ seconds: 2.5, a: [icon], b: [{ ...icon, x: 700 }] }], size)).toEqual(['"Icon rocket" jumps 300 px in one frame at 2.5 s: ease the move or cut on purpose.']);
	});

	it('ignores a box that appears or disappears', () => {
		expect(jumpIssues([{ seconds: 1, a: [icon], b: [] }, { seconds: 2, a: [], b: [icon] }], size)).toEqual([]);
	});

	it('ignores a 20 px move', () => {
		expect(jumpIssues([{ seconds: 1, a: [icon], b: [{ ...icon, x: 420 }] }], size)).toEqual([]);
	});

	it('does not pair two boxes of the same name', () => {
		const twin = { ...icon, x: 1400 };
		expect(jumpIssues([{ seconds: 1, a: [icon, twin], b: [{ ...icon, x: 900 }, twin] }], size)).toEqual([]);
	});
});

