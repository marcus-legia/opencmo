import { describe, expect, it } from 'vitest';

import { buildTimeline, cueFrame, MAX_JUMP_PAIRS, pairedProbes, previewFrames, probeFrames, stillFrames } from './timing.ts';

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

	it('previewFrames maps 1.5 s to frame 45', () => {
		expect(previewFrames(buildTimeline({ beats, duration: 10 }), [1.5])).toEqual([45]);
	});

	it('previewFrames clamps 999 s to the last frame, drops negatives, dedupes and sorts', () => {
		expect(previewFrames(buildTimeline({ beats, duration: 10 }), [999, 2, -1, 2, 0.5, Number.NaN])).toEqual([15, 60, 299]);
	});

	it('previewFrames without times equals stillFrames', () => {
		const timeline = buildTimeline({ beats, duration: 10 });
		expect(previewFrames(timeline)).toEqual(stillFrames(timeline));
		expect(previewFrames(timeline, [])).toEqual(stillFrames(timeline));
		expect(previewFrames(timeline, [-3])).toEqual(stillFrames(timeline));
	});

	it('pairedProbes adds the frame after every layout sample', () => {
		const timeline = buildTimeline({ beats, duration: 10 });
		const probes = probeFrames(timeline);
		const paired = pairedProbes(timeline);
		expect(paired).toHaveLength(probes.length * 2);
		for (const probe of probes) expect(paired).toContainEqual({ beat: probe.beat, frame: probe.frame + 1 });
	});

	it('pairedProbes adds at most 12 partner frames on a long explainer, spread over its beats', () => {
		const long = buildTimeline({ beats: Array.from({ length: 16 }, () => ({ say: 'six words in every one of these' })), duration: 90 });
		const probes = probeFrames(long);
		const paired = pairedProbes(long);
		expect(paired.length - probes.length).toBe(MAX_JUMP_PAIRS);
		const partners = paired.filter((probe) => !probes.some((sample) => sample.frame === probe.frame));
		expect(partners[0]!.beat).toBe(0);
		expect(partners.at(-1)!.beat).toBe(15);
	});

	it('a clip of beats 1.5 s and 2 s spans frames 0-45 and 45-105 in a 4 s timeline', () => {
		const timeline = buildTimeline({ kind: 'clip', beats: [{ say: 'The mark lands.', seconds: 1.5 }, { say: 'The name rises.', seconds: 2 }], duration: 4 });
		expect(timeline.estimated).toBe(false);
		expect(timeline.frames).toBe(120);
		expect(timeline.beats.map(({ from, to }) => [from, to])).toEqual([[0, 45], [45, 105]]);
		expect(cueFrame(timeline.beats[1]!, 'rises')).toBeGreaterThan(45);
		expect(cueFrame(timeline.beats[1]!, 'rises')).toBeLessThan(105);
	});

	it.each([
		{ seconds: [1.35, 1.35, 2.3], duration: 5 },
		{ seconds: Array.from({ length: 8 }, () => 0.517), duration: 5 },
	])('clip beats $seconds start within half a frame of their authored seconds', ({ seconds, duration }) => {
		const timeline = buildTimeline({ kind: 'clip', beats: seconds.map((value) => ({ say: 'A move.', seconds: value })), duration });
		let elapsed = 0;
		timeline.beats.forEach((beat, i) => {
			expect(Math.abs(beat.from - elapsed * 30)).toBeLessThanOrEqual(0.5);
			elapsed += seconds[i]!;
		});
		expect(timeline.beats.at(-1)!.to).toBe(Math.round(elapsed * 30));
	});
});
