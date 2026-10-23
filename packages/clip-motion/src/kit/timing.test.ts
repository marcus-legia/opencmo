import { describe, expect, it } from 'vitest';

import { buildTimeline, cueFrame, stillFrames } from './timing.ts';

const beats = [{ say: 'A noisy bar.' }, { say: 'The phone hears peaks.' }, { say: 'It finds the song.' }];

describe('timing', () => {
	it('maps real words to frames and beats start on their first word', () => {
		const words = [
			['A', 0.1], ['noisy', 0.3], ['bar.', 0.6],
			['The', 1.5], ['phone', 1.7], ['hears', 2.0], ['peaks.', 2.4],
			['It', 4.0], ['finds', 4.2], ['the', 4.5], ['song.', 4.7],
		].map(([text, start]) => ({ text: text as string, start: start as number, end: (start as number) + 0.2 }));
		const timeline = buildTimeline({ beats, duration: 10, words });
		expect(timeline.estimated).toBe(false);
		expect(timeline.beats.map((beat) => beat.from)).toEqual([0, 45, 120]);
		expect(timeline.beats[2]!.to).toBe(300);
		expect(cueFrame(timeline.beats[1]!, 'peaks')).toBe(72);
		expect(cueFrame(timeline.beats[2]!, 'Song')).toBe(141);
	});

	it('ignores whitespace-only words from the voice service', () => {
		const words = ['A', ' ', 'noisy', 'bar.', 'The', 'phone', 'hears', 'peaks.', 'It', 'finds', 'the', 'song.'].map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
		const timeline = buildTimeline({ beats, duration: 10, words });
		expect(cueFrame(timeline.beats[1]!, 'hears')).toBe(Math.round(6 * 0.5 * 30));
	});

	it('falls back to the beat start for a missing word', () => {
		const timeline = buildTimeline({ beats, duration: 10 });
		expect(timeline.estimated).toBe(true);
		expect(cueFrame(timeline.beats[1]!, 'guitar')).toBe(timeline.beats[1]!.from);
	});

	it('estimates at 2.4 words/s and compresses narration that does not fit', () => {
		const easy = buildTimeline({ beats, duration: 15 });
		expect(easy.beats[1]!.from).toBe(Math.round((3 / 2.4) * 30));
		const tight = buildTimeline({ beats: beats.map((beat) => ({ say: `${beat.say} ${'word '.repeat(30)}` })), duration: 10 });
		expect(tight.beats.every((beat) => beat.frames > 0)).toBe(true);
		expect(tight.beats[2]!.from).toBeLessThan(300);
	});

	it('keeps beats strictly increasing when real words run out', () => {
		const timeline = buildTimeline({ beats, duration: 10, words: [{ text: 'A', start: 0, end: 0.2 }] });
		const froms = timeline.beats.map((beat) => beat.from);
		expect(froms[1]!).toBeGreaterThan(froms[0]!);
		expect(froms[2]!).toBeGreaterThan(froms[1]!);
	});

	it('takes stills at beat midpoints plus the last frame', () => {
		const timeline = buildTimeline({ beats, duration: 10 });
		const frames = stillFrames(timeline);
		expect(frames).toHaveLength(4);
		expect(frames.at(-1)).toBe(299);
	});
});
