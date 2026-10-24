/**
 * The motion templates (templates/, from Opus's MIT remakes): each is valid scene code, previews with no layout or
 * jump issue, carries a usable direction and stays inside its kind's limits. Previews need Chrome Headless Shell.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MOTION_TEMPLATES, motionTemplate } from '../templates/index.ts';
import { guardScene } from './code/guard.ts';
import { CLIP_SECONDS } from './job.ts';
import { parseJob } from './prepare.ts';
import { previewJob } from './preview.ts';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4v4IBAAQAAYGaqzA6AAAAAElFTkSuQmCC';

/** Image names a template reads from its SLOTS by default. */
function imageNames(code: string): string[] {
	const slots = /const SLOTS = \{([\s\S]*?)\n\};/.exec(code)?.[1] ?? '';
	return [...new Set([...slots.matchAll(/'([a-z][a-z0-9-]*)'/g)].map((match) => match[1]!).filter((name) => /^screen-\d$|^logo$/.test(name)))];
}

describe('motion templates', () => {
	it('index.gen.ts is in sync with the template folders', () => {
		const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'build-templates.mjs');
		expect(spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' }).status).toBe(0);
	});

	it('has the ported templates and our own, MIT, each with a usable direction', () => {
		expect(MOTION_TEMPLATES.map((template) => template.id)).toEqual(['analytics-glow', 'mark-lockup', 'phone-carousel', 'product-tour']);
		expect(motionTemplate('nope')).toBeUndefined();
		for (const template of MOTION_TEMPLATES) {
			expect(template.source.license).toBe('MIT');
			expect(template.source.repo).toBe('opus-pro/opusclip-video-tools');
			expect(template.direction.length, template.id).toBeGreaterThanOrEqual(120);
			expect(template.direction.length, template.id).toBeLessThanOrEqual(3000);
			expect(template.code).toMatch(/^\/\/[^\n]*\n[\s\S]*const SLOTS = \{/);
			for (const slot of template.slots) expect(template.code, `${template.id}: slot ${slot.name}`).toContain(`  ${slot.name}:`);
		}
	});

	it('every template passes the scene guard and fits its kind', () => {
		for (const template of MOTION_TEMPLATES) {
			expect(guardScene(template.code), template.id).toBeNull();
			expect(template.kind).toBe('clip');
			expect(template.seconds).toBeGreaterThanOrEqual(CLIP_SECONDS.min);
			expect(template.seconds).toBeLessThanOrEqual(CLIP_SECONDS.max);
			const beats = template.beats.reduce((sum, beat) => sum + (beat.seconds ?? 0), 0);
			expect(beats, template.id).toBeLessThanOrEqual(template.seconds);
		}
	});

	it.each(MOTION_TEMPLATES.map((template) => [template.id, template] as const))('%s previews with no layout or jump issue', { timeout: 180_000 }, async (_id, template) => {
		const parsed = parseJob({
			kind: template.kind,
			title: template.title,
			code: template.code,
			beats: template.beats.map(({ visual: _visual, ...beat }) => beat),
			format: template.format,
			duration: template.seconds,
			assets: imageNames(template.code).map((name) => ({ name, src: PNG })),
		});
		if (!parsed.ok) throw new Error(parsed.message);
		const result = await previewJob(parsed.job, mkdtempSync(join(tmpdir(), `clip-motion-template-${template.id}-`)));
		expect(result).toMatchObject({ ok: true, issues: [] });
	});
});
