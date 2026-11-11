import { describe, expect, it } from 'vitest';

import { matchScript, offScript, sourceWords } from './script-take';
import type { Transcript } from './transcript';

/** A spoken line with evenly spaced words, as the eval fixtures make them. */
function line(text: string, start: number, end: number) {
	const words = text.split(' ');
	const step = (end - start) / words.length;
	return { text, words: words.map((word, index) => ({ text: word, start: start + index * step, end: start + (index + 0.85) * step })) };
}

const BEATS = [
	{ say: 'Editing video should be as easy as editing text.' },
	{ say: 'Delete a word in the transcript and the cut is made.' },
	{ say: 'Try it free on your next video.' },
];

describe('matchScript', () => {
	it('a take with a retake: the last good take is kept and the false start is proposed for the cut', () => {
		const transcript: Transcript = [
			line('Editing video should be as easy as editing text.', 0, 3),
			line('Delete a word in the uh', 3.5, 5),
			line('sorry let me do that again', 5.5, 7),
			line('Delete a word in the transcript and the cut is made.', 8, 11),
			line('Try it free on your next video.', 11.5, 13.5),
		];
		const words = sourceWords(transcript, { start: 0, end: 14 }, []);
		const takes = matchScript(BEATS, words);
		expect(takes.map((take) => take.status)).toEqual(['said', 'said', 'said']);
		expect(takes[1]!.start).toBeGreaterThanOrEqual(8);
		const cuts = offScript(words, takes);
		expect(cuts).toHaveLength(1);
		expect(cuts[0]!.start).toBeCloseTo(3.5, 1);
		expect(cuts[0]!.end).toBeLessThan(8);
	});

	it('a skipped beat is missing; a beat said in part is partly said', () => {
		const transcript: Transcript = [
			line('Editing video should be as easy as editing text.', 0, 3),
			line('Try it on your video.', 4, 6),
		];
		const takes = matchScript(BEATS, sourceWords(transcript, { start: 0, end: 7 }, []));
		expect(takes.map((take) => take.status)).toEqual(['said', 'missing', 'partly']);
		expect(takes[1]!.start).toBeUndefined();
	});

	it('beats said out of order are each found where they were said', () => {
		const transcript: Transcript = [
			line('Try it free on your next video.', 0, 2),
			line('Editing video should be as easy as editing text.', 3, 6),
		];
		const takes = matchScript(BEATS, sourceWords(transcript, { start: 0, end: 7 }, []));
		expect(takes[0]!.status).toBe('said');
		expect(takes[0]!.start).toBeGreaterThanOrEqual(3);
		expect(takes[2]!.status).toBe('said');
		expect(takes[2]!.start).toBeLessThan(2);
	});

	it('words already cut are not read, and a video that is not the script is never cut down to nothing', () => {
		const transcript: Transcript = [line('Something else entirely about the weather today.', 0, 3), line('Editing video should be as easy as editing text.', 4, 7)];
		const words = sourceWords(transcript, { start: 0, end: 8 }, [{ start: 3.9, end: 7.1 }]);
		const takes = matchScript(BEATS, words);
		expect(takes.every((take) => take.status === 'missing')).toBe(true);
		expect(offScript(words, takes)).toEqual([]);
	});
	it('a beat said in other words is missing, and then nothing is offered for the cut', () => {
		const transcript: Transcript = [
			line('Editing video should be as easy as editing text.', 0, 3),
			line('You just strike out what you said and it is gone from the video.', 4, 8),
			line('Try it free on your next video.', 9, 11),
		];
		const words = sourceWords(transcript, { start: 0, end: 12 }, []);
		const takes = matchScript(BEATS, words);
		expect(takes[1]!.status).toBe('missing');
		expect(offScript(words, takes)).toEqual([]);
	});

	it('a short beat keeps its first take after the beat before it, not a later chance match', () => {
		const beats = [{ say: 'Editing video should be as easy as editing text.' }, { say: 'Try it now.' }];
		const transcript: Transcript = [
			line('Editing video should be as easy as editing text.', 0, 3),
			line('Try it now.', 3.5, 4.5),
			line('Honestly people tell me to try it now and they do.', 6, 9),
		];
		const takes = matchScript(beats, sourceWords(transcript, { start: 0, end: 10 }, []));
		expect(takes[1]!.start).toBeLessThan(4);
	});
});
