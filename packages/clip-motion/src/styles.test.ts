/**
 * Motion styles (styles/): each example is valid scene code built from the kit core — no icons or Stage —
 * and previews with no layout, beat or jump issue. Previews need Chrome Headless Shell.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MOTION_STYLES, motionStyle } from '../styles/index.ts';
import { guardScene } from './code/guard.ts';
import { CLIP_SECONDS } from './job.ts';
import { parseJob } from './prepare.ts';
import { previewJob } from './preview.ts';

describe('motion styles', () => {
	it('index.gen.ts is in sync with the style folders', () => {
		const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'build-styles.mjs');
		expect(spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' }).status).toBe(0);
	});

	it('each style has a guide with every section and an example from the kit core', () => {
		expect(MOTION_STYLES.length).toBeGreaterThanOrEqual(1);
		expect(motionStyle('nope')).toBeUndefined();
		for (const style of MOTION_STYLES) {
			for (const section of ['## Palette', '## Background', '## Type', '## Motion', '## Composition', '## Do / don']) expect(style.guide, `${style.id}: ${section}`).toContain(section);
			expect(guardScene(style.code), style.id).toBeNull();
			expect(style.code, style.id).not.toMatch(/<(Icon|Stage)\b/);
			expect(style.seconds).toBeGreaterThanOrEqual(CLIP_SECONDS.min);
			expect(style.seconds).toBeLessThanOrEqual(CLIP_SECONDS.max);
			expect(style.beats.reduce((sum, beat) => sum + beat.seconds, 0), style.id).toBeCloseTo(style.seconds, 5);
			if (style.source) expect(style.source.license).toBe('MIT');
		}
	});

	it.each(MOTION_STYLES.map((style) => [style.id, style] as const))('%s previews with no issue', { timeout: 240_000 }, async (_id, style) => {
		const parsed = parseJob({ title: style.title, code: style.code, beats: style.beats.map(({ say, seconds }) => ({ say, seconds })), kind: 'clip', format: style.format, duration: Math.ceil(style.seconds) });
		if (!parsed.ok) throw new Error(parsed.message);
		const result = await previewJob(parsed.job, mkdtempSync(join(tmpdir(), `clip-motion-style-${style.id}-`)));
		if (!result.ok) throw new Error(`${result.phase}: ${result.message}`);
		expect(result.issues).toEqual([]);
	});
});
