import { describe, expect, it } from 'vitest';

import { captionFrame, isEmphasized, sourceStart, type TranscriptWord } from './captions.ts';

const words = (list: [string, number, number, string?][]): TranscriptWord[] =>
  list.map(([text, start, end, id]) => ({ text, start, end, ...(id ? { id } : {}) }));

/** The id editor-core gives a word: `w` + its source start in ms, base 36. */
const idAt = (seconds: number) => `w${Math.round(seconds * 1000).toString(36)}`;

describe('caption emphasis', () => {
	it('a word is matched by its SOURCE start: the id after a cut, the time before one', () => {
		expect(sourceStart({ text: 'x', start: 0.5, end: 0.9, id: idAt(12.34) })).toBe(12.34);
		expect(sourceStart({ text: 'x', start: 0.5, end: 0.9, id: `${idAt(12.34)}-2` })).toBe(12.34);
		expect(sourceStart({ text: 'x', start: 0.5, end: 0.9 })).toBe(0.5);
		expect(sourceStart({ text: 'x', start: 0.5, end: 0.9, id: 'custom' })).toBe(0.5);
		expect(isEmphasized({ text: '24', start: 1, end: 1.2, id: idAt(10.8) }, [{ start: 10.8, end: 10.8 }])).toBe(true);
		expect(isEmphasized({ text: 'it', start: 0.6, end: 0.8, id: idAt(10.4) }, [{ start: 10.8, end: 10.8 }])).toBe(false);
	});

	it('emphasized words get the emphasis font and colour over the preset, the rest stay', () => {
		// A clip cut in front of "24": clip times start at 0, ids keep the source starts.
		const group = [words([['it', 0, 0.3, idAt(10)], ['has', 0.4, 0.7, idAt(10.4)], ['24', 0.8, 1.1, idAt(10.8)]])];
		const frame = captionFrame(
			{ kind: 'captions', preset: 'spotlight', emphasis: [{ start: 10.8, end: 10.8 }], emphasisStyle: { fontFamily: 'Lora', fontStyle: 'italic', color: '#FF5500', scale: 1.2 } },
			group,
			0.2,
			0,
		);
		const emphasized = frame.node.ranges!.find((range) => range.fontStyle === 'italic')!;
		expect(frame.text.slice(emphasized.start, emphasized.end)).toBe('24');
		expect(emphasized).toMatchObject({ fontFamily: 'Lora', paints: [{ type: 'solid', color: '#FF5500' }], fontSize: 70 * 1.2 });
		expect(frame.node.ranges!.filter((range) => range.fontStyle === 'italic')).toHaveLength(1);
	});

	it('the emphasis colour wins over spotlight while the word is spoken; stark keeps only the font', () => {
		const group = [words([['so', 0, 0.3], ['free', 0.4, 0.8]])];
		const node = { kind: 'captions' as const, preset: 'spotlight' as const, emphasis: [{ start: 0.4, end: 0.4 }], emphasisStyle: { color: '#FF5500' } };
		const frame = captionFrame(node, group, 0.6, 0);
		const last = frame.node.ranges!.filter((range) => range.start === 3 && range.paints).at(-1)!;
		expect(last.paints).toEqual([{ type: 'solid', color: '#FF5500' }]);
		const stark = captionFrame({ ...node, preset: 'stark', emphasisStyle: { fontStyle: 'italic', color: '#FF5500' } }, group, 0.6, 0);
		expect(stark.node.ranges).toEqual([{ start: 3, end: 7, fontStyle: 'italic' }]);
	});

	it('reveal fade: unspoken words at 35% ink, full ink 120 ms after their start', () => {
		const group = [words([['one', 0, 0.3], ['two', 0.5, 0.8], ['three', 1, 1.3]])];
		const node = { kind: 'captions' as const, preset: 'classic' as const, maxWords: 3, reveal: 'fade' as const };
		const frame = captionFrame(node, group, 0.56, 0);
		const color = (word: string) => frame.node.ranges!.find((range) => frame.text.slice(range.start, range.end) === word)?.paints?.[0];
		expect(color('one')).toBeUndefined();
		// Halfway through its 120 ms: between muted and full.
		expect(color('two')).toEqual({ type: 'solid', color: '#ACACAC' });
		expect(color('three')).toEqual({ type: 'solid', color: '#595959' });
		expect(captionFrame(node, group, 1.2, 0).node.ranges).toBeUndefined();
		// Dark ink mutes toward white.
		const dark = captionFrame({ ...node, color: '#000000' }, group, 0, 0);
		expect(dark.node.ranges!.at(-1)!.paints).toEqual([{ type: 'solid', color: '#A6A6A6' }]);
	});
});
