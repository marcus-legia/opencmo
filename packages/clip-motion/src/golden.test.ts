/**
 * Golden stills: the showcase (blueprint, v1) and the vaccine scene (paper, v2 kit) rendered at quarter size must match
 * the stored PNGs, measured like
 * editor-parity (mean channel difference and worst 16×16 tile). Needs Chrome Headless Shell and ffmpeg.
 * UPDATE_GOLDEN=1 rewrites the references; look at them before committing.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseJob, prepare } from './prepare.ts';
import { previewJob, renderStills } from './preview.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const FIXTURES: Record<string, number[]> = { showcase: [100, 330, 520, 860], vaccine: [75, 244, 569, 725] };
const LIMIT = { mean: 1.5, tile: 10 };

function pixels(file: string): { data: Buffer; width: number; height: number } {
	const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' });
	const [width, height] = probe.stdout.trim().split(',').map(Number) as [number, number];
	const raw = spawnSync('ffmpeg', ['-v', 'error', '-f', 'png_pipe', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
	return { data: raw.stdout, width, height };
}

function compare(a: string, b: string): { mean: number; tile: number } {
	const x = pixels(a);
	const y = pixels(b);
	expect([y.width, y.height]).toEqual([x.width, x.height]);
	let total = 0;
	let tile = 0;
	const size = 16;
	for (let ty = 0; ty < x.height; ty += size) {
		for (let tx = 0; tx < x.width; tx += size) {
			let sum = 0;
			let count = 0;
			for (let py = ty; py < Math.min(ty + size, x.height); py++) {
				for (let px = tx; px < Math.min(tx + size, x.width); px++) {
					for (let c = 0; c < 3; c++) {
						const i = (py * x.width + px) * 3 + c;
						const d = Math.abs(x.data[i]! - y.data[i]!);
						sum += d;
						total += d;
						count++;
					}
				}
			}
			tile = Math.max(tile, sum / count);
		}
	}
	return { mean: total / (x.width * x.height * 3), tile };
}

describe.each(Object.entries(FIXTURES))('%s golden stills', (name, frames) => {
	it('keeps the scene file and the job fixture in sync', () => {
		const job = JSON.parse(readFileSync(join(fixtures, `${name}.job.json`), 'utf8'));
		expect(job.code).toBe(readFileSync(join(fixtures, `${name}.scene.jsx`), 'utf8'));
	});

	it('matches the reference images', { timeout: 240_000 }, async () => {
		const parsed = parseJob(JSON.parse(readFileSync(join(fixtures, `${name}.job.json`), 'utf8')));
		if (!parsed.ok) throw new Error(parsed.message);
		const dir = mkdtempSync(join(tmpdir(), 'clip-motion-golden-'));
		const stills = await renderStills(parsed.job, prepare(parsed.job).compiled, frames, dir, { scale: 0.25, format: 'png' });
		for (const still of stills) {
			const reference = join(fixtures, 'golden', `${name}-${still.frame}.png`);
			if (process.env.UPDATE_GOLDEN === '1' || !existsSync(reference)) {
				if (process.env.UPDATE_GOLDEN !== '1') throw new Error(`Missing ${reference}: run with UPDATE_GOLDEN=1 and look at the images.`);
				copyFileSync(still.file, reference);
				continue;
			}
			const diff = compare(reference, still.file);
			expect({ frame: still.frame, ...diff, ok: diff.mean <= LIMIT.mean && diff.tile <= LIMIT.tile }).toMatchObject({ frame: still.frame, ok: true });
		}
	});
});

describe('kit.Image', () => {
	// A 1×1 orange PNG, stretched over a 600×400 box.
	const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4v4IBAAQAAYGaqzA6AAAAAElFTkSuQmCC';
	const job = (code: string) => {
		const parsed = parseJob({
			title: 'Image',
			code,
			beats: [{ say: 'The shot.', seconds: 3 }],
			kind: 'clip',
			format: '16:9',
			duration: 3,
			assets: [{ name: 'shot', src: PNG }],
		});
		if (!parsed.ok) throw new Error(parsed.message);
		return parsed.job;
	};

	it('draws the image and reports its box as a mark', { timeout: 120_000 }, async () => {
		const scene = "const { Stage, Image } = kit;\nreturn function Scene() { return <Stage><Image name={kit.images[0]} x={660} y={340} w={600} h={400} at={0} dur={1} /></Stage>; };";
		const dir = mkdtempSync(join(tmpdir(), 'clip-motion-image-'));
		const [still] = await renderStills(job(scene), prepare(job(scene)).compiled, [45], dir, { scale: 0.25, format: 'png' });
		expect(still!.boxes).toContainEqual({ kind: 'mark', name: 'Image shot', x: 660, y: 340, w: 600, h: 400 });
		const { data, width } = pixels(still!.file);
		const at = (x: number, y: number) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
		// Centre of the box at quarter size: the PNG's orange; a corner of the frame: the field.
		const [r, g, b] = at(240, 135);
		expect(r).toBeGreaterThan(200);
		expect(g).toBeGreaterThan(80);
		expect(b).toBeLessThan(60);
		expect(at(5, 5)[0]).toBeLessThan(60);
	});

	it('names the available images when the scene asks for another', { timeout: 120_000 }, async () => {
		const scene = "const { Stage, Image } = kit;\nreturn function Scene() { return <Stage><Image name=\"nope\" x={0} y={0} w={10} h={10} /></Stage>; };";
		const result = await previewJob(job(scene), mkdtempSync(join(tmpdir(), 'clip-motion-image-')));
		expect(result).toEqual({ ok: false, phase: 'render', message: expect.stringContaining('kit: unknown image "nope": this job has "shot"') });
	});
});

describe('kit device frames and the display face', () => {
	const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4v4IBAAQAAYGaqzA6AAAAAElFTkSuQmCC';
	const stillOf = async (code: string, format: '16:9' | '9:16' = '16:9') => {
		const parsed = parseJob({ kind: 'clip', title: 'Devices', code, beats: [{ say: 'A product moment.', seconds: 3 }], format, duration: 3, assets: [{ name: 'screen', src: PNG }] });
		if (!parsed.ok) throw new Error(parsed.message);
		const dir = mkdtempSync(join(tmpdir(), 'clip-motion-devices-'));
		const [still] = await renderStills(parsed.job, prepare(parsed.job).compiled, [60], dir, { scale: 0.25, format: 'png' });
		return still!.boxes!;
	};
	const box = (boxes: { name: string; x: number; y: number; w: number; h: number }[], name: string) => {
		const found = boxes.find((item) => item.name === name);
		if (!found) throw new Error(`no box "${name}" in ${boxes.map((item) => item.name).join(', ')}`);
		return found;
	};

	it('a phone holds the image inside its bezel, on a 9:19.5 screen', { timeout: 120_000 }, async () => {
		const boxes = await stillOf("const { Stage, Phone } = kit;\nreturn function Scene() { return <Stage><Phone image=\"screen\" x={540} y={960} w={600} at={0} dur={1} /></Stage>; };", '9:16');
		const phone = box(boxes, 'Phone');
		const screen = box(boxes, 'Image screen');
		expect(phone.w).toBeCloseTo(600, 0);
		expect(screen.x).toBeGreaterThan(phone.x);
		expect(screen.y).toBeGreaterThan(phone.y);
		expect(screen.x + screen.w).toBeLessThan(phone.x + phone.w);
		expect(screen.y + screen.h).toBeLessThan(phone.y + phone.h);
		expect(screen.h / screen.w).toBeCloseTo(19.5 / 9, 2);
		expect(phone.x + phone.w / 2).toBeCloseTo(540, 0);
		expect(phone.y + phone.h / 2).toBeCloseTo(960, 0);
	});

	it('a browser at w 960 has a 40 px bar over a 16:10 page at 1080', { timeout: 120_000 }, async () => {
		const boxes = await stillOf("const { Stage, Browser } = kit;\nreturn function Scene() { return <Stage><Browser image=\"screen\" x={960} y={540} w={960} at={0} dur={1} /></Stage>; };");
		const browser = box(boxes, 'Browser');
		const page = box(boxes, 'Image screen');
		expect(page.w).toBeCloseTo(960, 0);
		expect(page.h).toBeCloseTo(600, 0);
		expect(browser.h - page.h).toBeCloseTo(40, 0);
		expect(page.y - browser.y).toBeCloseTo(40, 0);
	});

	it('kit.font.display is Plus Jakarta Sans, loaded before frame 0', { timeout: 120_000 }, async () => {
		// Two fallbacks that differ a lot: the widths match only if the display face itself drew both.
		const tag = (name: string, fallback: string) =>
			`<div data-box="text" data-name="${name}" data-size="96" style={{ position: 'absolute', left: 200, top: ${name === 'serif' ? 300 : 600}, fontSize: 96, fontFamily: kit.font.display.replace('system-ui, sans-serif', '${fallback}') }}>Ship the week</div>`;
		const boxes = await stillOf(`const { Stage } = kit;\nreturn function Scene() { return <Stage>${tag('serif', 'serif')}${tag('mono', 'monospace')}</Stage>; };`);
		expect(box(boxes, 'serif').w).toBeCloseTo(box(boxes, 'mono').w, 0);
		expect(box(boxes, 'serif').w).toBeGreaterThan(400);
	});
});

describe('kit.color', () => {
	it('follows the job theme', async () => {
		const { makeKit } = await import('./kit/index.ts');
		const job = (theme: 'paper' | 'blueprint') => ({ title: 'T', code: 'x', beats: [{ say: 'a' }, { say: 'b' }, { say: 'c' }], format: '16:9' as const, duration: 15, seed: 0, theme });
		expect(makeKit(job('paper'), { width: 1920, height: 1080 }).color.text).toBe('#1D2733');
		expect(makeKit(job('blueprint'), { width: 1920, height: 1080 }).color.text).toBe('#EAF0FA');
	});
});
