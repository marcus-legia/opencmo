/** Preview: half-size stills (at the times the model chose, or beat midpoints) plus the layout report, to look at and fix. */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openBrowser, renderStill, selectComposition, type HeadlessBrowser } from '@remotion/renderer';

import { MotionCodeFailure } from './errors.ts';
import { checkAssets, stageAssets } from './job-assets.ts';
import { FPS, frameSize, type MotionJob, type PreviewResult, type PreviewStill } from './job.ts';
import { buildTimeline, pairedProbes, previewFrames } from './kit/timing.ts';
import { auditIssues, beatIssues, jumpIssues, layoutIssues, movingBoxes, type LaidBox } from './layout.ts';
import type { AuditCheck } from './kit/audit.ts';
import { prepare } from './prepare.ts';
import { browserExecutable, CHROMIUM, getBundle, sceneFailure, type Log } from './render.ts';
import { AUDIT_LOG, LAYOUT_LOG } from './remotion/layout-log.ts';

export type Still = { frame: number; file: string; boxes: LaidBox[] | null; checks?: AuditCheck[] };

/** Render chosen frames as stills in one browser, collecting the layout boxes of each. */
export async function renderStills(
	job: MotionJob,
	compiled: string | null,
	frames: number[],
	dir: string,
	options: { log?: Log; scale?: number; format?: 'jpeg' | 'png'; browser?: HeadlessBrowser } = {},
): Promise<Still[]> {
	mkdirSync(dir, { recursive: true });
	const serveUrl = await getBundle(options.log);
	const inputProps = { job, compiled, probe: true };
	const browser = options.browser ?? (await openPreviewBrowser());
	const format = options.format ?? 'jpeg';
	const stills: Still[] = [];
	try {
		const composition = await selectComposition({ serveUrl, id: 'explainer', inputProps, puppeteerInstance: browser, logLevel: 'error' });
		for (const frame of frames) {
			const file = join(dir, `still-${String(frame).padStart(4, '0')}.${format === 'png' ? 'png' : 'jpg'}`);
			let boxes: LaidBox[] | null = null;
			let checks: AuditCheck[] | undefined;
			await renderStill({
				composition,
				serveUrl,
				frame,
				inputProps,
				output: file,
				imageFormat: format,
				...(format === 'jpeg' ? { jpegQuality: 82 } : {}),
				scale: options.scale ?? 0.5,
				puppeteerInstance: browser,
				timeoutInMilliseconds: 30_000,
				logLevel: 'error',
				onBrowserLog: (entry) => {
					if (entry.text.startsWith(LAYOUT_LOG)) boxes = JSON.parse(entry.text.slice(LAYOUT_LOG.length)) as LaidBox[];
					if (entry.text.startsWith(AUDIT_LOG)) checks = JSON.parse(entry.text.slice(AUDIT_LOG.length)) as AuditCheck[];
				},
			});
			stills.push({ frame, file, boxes, ...(checks ? { checks } : {}) });
		}
	} catch (error) {
		throw sceneFailure(error) ?? error;
	} finally {
		// A shared browser (serve) stays open. Closing after a failed page can reject with "Target closed".
		if (!options.browser) await browser.close({ silent: true }).catch(() => undefined);
	}
	return stills;
}

/** The Chromium a preview renders in, with the kit's offline flags. */
export function openPreviewBrowser(): Promise<HeadlessBrowser> {
	return openBrowser('chrome', { browserExecutable: browserExecutable(), chromiumOptions: CHROMIUM, logLevel: 'error' });
}

/** Frames of a contact sheet: `count` evenly from `from` to `to` seconds, clamped to the video. */
export function sheetFrames(sheet: { from: number; to: number; count: number }, frames: number): number[] {
	const last = frames - 1;
	const a = Math.min(last, Math.round(sheet.from * FPS));
	const b = Math.min(last, Math.round(sheet.to * FPS));
	return [...new Set(Array.from({ length: sheet.count }, (_, i) => Math.round(a + ((b - a) * i) / (sheet.count - 1))))];
}

/** Tiles same-size images into one JPEG, `columns` per row, with a thin light gutter. */
function tile(files: string[], columns: number, out: string): void {
	const rows = Math.ceil(files.length / columns);
	const inputs = files.flatMap((file) => ['-i', file]);
	const graph = `${files.map((_, i) => `[${i}:v]`).join('')}concat=n=${files.length}:v=1:a=0,tile=${columns}x${rows}:padding=6:margin=6:color=0xEEEEEE`;
	execFileSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-frames:v', '1', '-q:v', '3', out], { stdio: ['ignore', 'ignore', 'pipe'] });
}

/** Crops `box` (composition px) out of a full-size still. */
function crop(file: string, box: { x: number; y: number; w: number; h: number }, size: { width: number; height: number }, out: string): void {
	const x = Math.max(0, Math.min(size.width - 16, Math.round(box.x)));
	const y = Math.max(0, Math.min(size.height - 16, Math.round(box.y)));
	const w = Math.max(16, Math.min(size.width - x, Math.round(box.w)));
	const h = Math.max(16, Math.min(size.height - y, Math.round(box.h)));
	execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `crop=${w}:${h}:${x}:${y}`, '-q:v', '2', out], { stdio: ['ignore', 'ignore', 'pipe'] });
}

export type PreviewOptions = { log?: Log; scale?: number; browser?: HeadlessBrowser };

export async function previewJob(input: MotionJob, outdir: string, options: PreviewOptions = {}): Promise<PreviewResult> {
	const started = Date.now();
	let job: MotionJob;
	try {
		// Before Chromium: a bad image is a job error the model can fix.
		job = checkAssets(input);
	} catch (error) {
		if (error instanceof MotionCodeFailure) return { ok: false, phase: error.phase, message: error.message };
		throw error;
	}
	const timeline = buildTimeline(job);
	const { width, height } = frameSize(job.format);
	let stills: Still[];
	let probes: Still[];
	let neighbours: Still[] = [];
	let sheet: Still[] = [];
	const extras: PreviewStill[] = [];
	// Each layout sample and the frame after it: the pair measures one-frame jumps.
	const probeList = pairedProbes(timeline);
	let own: HeadlessBrowser | null = null;
	// Images as bundle files, written once for every still and probe of this preview.
	const staged = stageAssets(job, await getBundle(options.log));
	try {
		const { compiled } = prepare(job);
		// One browser for the stills and the layout samples (serve passes its own).
		const browser = options.browser ?? (own = await openPreviewBrowser());
		stills = await renderStills(staged.job, compiled, previewFrames(timeline, job.stills), resolve(outdir), { ...options, browser });
		// Layout-only samples at quarter size, kept out of the stills the Assistant looks at; plus the frame after each
		// still, so a still caught mid-move knows what is moving.
		const probeFrames = probeList.map((probe) => probe.frame);
		const after = [...new Set(stills.map((still) => still.frame + 1))].filter((frame) => frame < timeline.frames && !probeFrames.includes(frame));
		const sampled = await renderStills(staged.job, compiled, [...probeFrames, ...after], join(resolve(outdir), 'probes'), { ...options, browser, scale: 0.25 });
		probes = sampled.slice(0, probeFrames.length);
		neighbours = sampled.slice(probeFrames.length);
		const out = resolve(outdir);
		if (job.sheet) {
			// Motion across a window in one image: the model sees the curve, not three moments.
			const frames = sheetFrames(job.sheet, timeline.frames);
			sheet = await renderStills(staged.job, compiled, frames, join(out, 'sheet'), { ...options, browser, scale: 0.25, format: 'png' });
			const columns = Math.min(3, frames.length);
			tile(sheet.map((still) => still.file), columns, join(out, 'sheet.jpg'));
			extras.push({ t: frames[0]! / FPS, file: join(out, 'sheet.jpg'), kind: 'sheet', times: frames.map((frame) => Math.round((frame / FPS) * 100) / 100), columns });
		}
		if (job.zoom) {
			const frame = Math.min(timeline.frames - 1, Math.round(job.zoom.t * FPS));
			const [full] = await renderStills(staged.job, compiled, [frame], join(out, 'zoom'), { ...options, browser, scale: 1, format: 'png' });
			crop(full!.file, job.zoom, { width, height }, join(out, 'zoom.jpg'));
			extras.push({ t: Math.round((frame / FPS) * 100) / 100, file: join(out, 'zoom.jpg'), kind: 'zoom' });
		}
	} catch (error) {
		if (error instanceof MotionCodeFailure) return { ok: false, phase: error.phase, message: error.message };
		throw error;
	} finally {
		if (own) await own.close({ silent: true }).catch(() => undefined);
		staged.dispose();
	}
	const byFrame = new Map([...probes, ...neighbours].map((probe) => [probe.frame, probe.boxes]));
	const issues = [...stills, ...probes]
		.sort((a, b) => a.frame - b.frame)
		.flatMap((still) => {
			if (!still.boxes) return [];
			// Moving between this frame and the one after or before it (probes come in pairs).
			const near = [byFrame.get(still.frame + 1), byFrame.get(still.frame - 1)].filter((boxes): boxes is LaidBox[] => Boolean(boxes));
			const moving = new Set(near.flatMap((boxes) => [...movingBoxes(still.boxes!, boxes)]));
			// Without a neighbouring frame nothing is known to be at rest: `moving` stays unset and the rest checks skip it.
			return layoutIssues(still.boxes, { width, height, seconds: still.frame / FPS }, { clip: job.kind === 'clip', ...(near.length ? { moving } : {}) });
		});
	issues.push(...beatIssues(probeList.map((probe, i) => ({ beat: probe.beat, boxes: probes[i]?.boxes ?? null })), { width, height }));
	const pairs = probes.flatMap((probe) => {
		const next = byFrame.get(probe.frame + 1);
		return probe.boxes && next ? [{ seconds: probe.frame / FPS, a: probe.boxes, b: next }] : [];
	});
	issues.push(...jumpIssues(pairs, { width, height }));
	const checks = [...stills, ...probes, ...sheet].find((still) => still.checks)?.checks ?? [];
	issues.push(...auditIssues(checks, [...stills, ...probes, ...neighbours, ...sheet].map((still) => ({ seconds: still.frame / FPS, boxes: still.boxes }))));
	for (const dir of ['probes', 'sheet', 'zoom']) rmSync(join(resolve(outdir), dir), { recursive: true, force: true });
	options.log?.(`preview: ${stills.length} stills in ${Date.now() - started} ms`);
	return { ok: true, stills: [...stills.map((still) => ({ t: Math.round((still.frame / FPS) * 100) / 100, file: still.file })), ...extras], issues: [...new Set(issues)], estimated: timeline.estimated };
}
