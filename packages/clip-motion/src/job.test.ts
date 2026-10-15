import { describe, expect, it } from 'vitest';

import { estimateDuration, MotionJobSchema } from './job.ts';
import { parseJob } from './prepare.ts';

const beats = (n: number, words: number) => Array.from({ length: n }, () => ({ say: Array(words).fill('word').join(' ') }));

describe('job contract', () => {
	it('estimates 2.4 words/s plus a 1.5 s tail, rounded up to 5 s', () => {
		expect(estimateDuration(beats(8, 10))).toBe(35); // 80 / 2.4 + 1.5 = 34.8
		expect(estimateDuration(beats(3, 1))).toBe(15);
		expect(estimateDuration(beats(16, 60))).toBe(90);
	});

	it('defaults the seed and rejects unknown keys', () => {
		const job = { title: 'T', code: 'return () => null', beats: beats(3, 2), format: '9:16', duration: 20 };
		expect(MotionJobSchema.parse(job).seed).toBe(0);
		const bad = parseJob({ ...job, extra: 1 });
		expect(bad.ok).toBe(false);
	});

	it('names the failing field', () => {
		const bad = parseJob({ title: 'T', code: 'x', beats: beats(2, 2), format: '16:9', duration: 20 });
		expect(bad).toEqual({ ok: false, message: expect.stringContaining('beats') });
	});
});
