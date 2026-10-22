import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

	it('takes an optional theme and personality and rejects other values', () => {
		const job = { title: 'T', code: 'return () => null', beats: beats(3, 2), format: '16:9', duration: 20 };
		expect(MotionJobSchema.parse(job).theme).toBeUndefined();
		expect(MotionJobSchema.parse({ ...job, theme: 'paper', personality: 'playful' })).toMatchObject({ theme: 'paper', personality: 'playful' });
		expect(parseJob({ ...job, theme: 'neon' })).toEqual({ ok: false, message: expect.stringContaining('theme') });
		expect(parseJob({ ...job, personality: 'bouncy' })).toEqual({ ok: false, message: expect.stringContaining('personality') });
	});

	it('names the failing field', () => {
		const bad = parseJob({ title: 'T', code: 'x', beats: beats(2, 2), format: '16:9', duration: 20 });
		expect(bad).toEqual({ ok: false, message: expect.stringContaining('beats') });
	});

	const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
	const clip = { kind: 'clip', title: 'Logo', code: 'return () => null', beats: [{ say: 'The mark lands.', seconds: 3 }], format: '16:9', duration: 3 };
	const explainer = { title: 'T', code: 'return () => null', beats: beats(3, 2), format: '16:9', duration: 20 };

	it('accepts a silent clip of 3 s with one timed beat', () => {
		expect(parseJob(clip)).toMatchObject({ ok: true, job: { kind: 'clip', duration: 3 } });
	});

	it('refuses a clip beat without seconds', () => {
		expect(parseJob({ ...clip, beats: [{ say: 'No time.' }] })).toEqual({ ok: false, message: expect.stringMatching(/^beats\.0\.seconds: /) });
	});

	it('refuses a clip whose beats add up past its duration', () => {
		const bad = parseJob({ ...clip, beats: [{ say: 'One.', seconds: 2 }, { say: 'Two.', seconds: 1.5 }] });
		expect(bad).toEqual({ ok: false, message: expect.stringContaining('3.5 s, longer than') });
		expect(parseJob({ ...clip, duration: 31, beats: [{ say: 'Long.', seconds: 30 }] }).ok).toBe(false);
		expect(parseJob({ ...clip, beats: Array.from({ length: 9 }, () => ({ say: 'x', seconds: 0.5 })), duration: 5 }).ok).toBe(false);
	});

	it('refuses 7 assets', () => {
		const assets = Array.from({ length: 7 }, (_, i) => ({ name: `shot-${i}`, src: PNG }));
		expect(parseJob({ ...explainer, assets })).toEqual({ ok: false, message: expect.stringContaining('assets') });
		expect(parseJob({ ...explainer, assets: assets.slice(0, 6) }).ok).toBe(true);
	});

	it('refuses two assets named "logo"', () => {
		expect(parseJob({ ...explainer, assets: [{ name: 'logo', src: PNG }, { name: 'logo', src: PNG }] })).toEqual({ ok: false, message: expect.stringContaining('Two images are named "logo"') });
	});

	it('refuses an asset name "Logo"', () => {
		expect(parseJob({ ...explainer, assets: [{ name: 'Logo', src: PNG }] })).toEqual({ ok: false, message: expect.stringMatching(/^assets\.0\.name: /) });
		expect(parseJob({ ...explainer, assets: [{ name: 'logo', src: 'http://x/a.png' }] }).ok).toBe(false);
		expect(parseJob({ ...explainer, assets: [{ name: 'logo', src: 'data:image/svg+xml;base64,PHN2Zz4=' }] }).ok).toBe(false);
	});

	it('keeps an explainer without kind valid as today', () => {
		const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
		for (const name of ['showcase', 'vaccine']) {
			const job = JSON.parse(readFileSync(join(fixtures, `${name}.job.json`), 'utf8'));
			expect(parseJob(job)).toMatchObject({ ok: true, job: { ...job, seed: job.seed ?? 0 } });
		}
		expect(parseJob({ ...explainer, duration: 5 }).ok).toBe(false);
		expect(parseJob({ ...explainer, beats: beats(2, 2) }).ok).toBe(false);
	});

	it('refuses 13 preview stills', () => {
		expect(parseJob({ ...explainer, stills: Array.from({ length: 12 }, (_, i) => i) }).ok).toBe(true);
		expect(parseJob({ ...explainer, stills: Array.from({ length: 13 }, (_, i) => i) })).toEqual({ ok: false, message: expect.stringContaining('stills') });
	});
});
