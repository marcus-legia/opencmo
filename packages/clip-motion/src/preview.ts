/** Preview: a few half-size stills plus the layout report, for the Assistant to look at and fix. */

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openBrowser, renderStill, selectComposition } from '@remotion/renderer';

import { MotionCodeFailure } from './errors.ts';
import { FPS, frameSize, type MotionJob, type PreviewResult } from './job.ts';
import { buildTimeline, stillFrames } from './kit/timing.ts';
import { layoutIssues, type LaidBox } from './layout.ts';
import { prepare } from './prepare.ts';
import { browserExecutable, CHROMIUM, getBundle, sceneFailure, type Log } from './render.ts';
import { LAYOUT_LOG } from './remotion/layout-log.ts';

export type Still = { frame: number; file: string; boxes: LaidBox[] | null };

/** Render chosen frames as stills in one browser, collecting the layout boxes of each. */
export async function renderStills(
	job: MotionJob,
	compiled: string | null,
	frames: number[],
	dir: string,
	options: { log?: Log; scale?: number; format?: 'jpeg' | 'png' } = {},
): Promise<Still[]> {
	mkdirSync(dir, { recursive: true });
	const serveUrl = await getBundle(options.log);
	const inputProps = { job, compiled, probe: true };
	const browser = await openBrowser('chrome', { browserExecutable: browserExecutable(), chromiumOptions: CHROMIUM, logLevel: 'error' });
	const format = options.format ?? 'jpeg';
	const stills: Still[] = [];
	try {
		const composition = await selectComposition({ serveUrl, id: 'explainer', inputProps, puppeteerInstance: browser, logLevel: 'error' });
		for (const frame of frames) {
			const file = join(dir, `still-${String(frame).padStart(4, '0')}.${format === 'png' ? 'png' : 'jpg'}`);
			let boxes: LaidBox[] | null = null;
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
				},
			});
			stills.push({ frame, file, boxes });
		}
	} catch (error) {
		throw sceneFailure(error) ?? error;
	} finally {
		// Closing after a failed page can reject with "Target closed"; the render error is what matters.
		await browser.close({ silent: true }).catch(() => undefined);
	}
	return stills;
}

export async function previewJob(job: MotionJob, outdir: string, options: { log?: Log; scale?: number } = {}): Promise<PreviewResult> {
	const started = Date.now();
	const timeline = buildTimeline(job);
	const { width, height } = frameSize(job.format);
	let stills: Still[];
	try {
		const { compiled } = prepare(job);
		stills = await renderStills(job, compiled, stillFrames(timeline), resolve(outdir), options);
	} catch (error) {
		if (error instanceof MotionCodeFailure) return { ok: false, phase: error.phase, message: error.message };
		throw error;
	}
	const issues = stills.flatMap((still) => (still.boxes ? layoutIssues(still.boxes, { width, height, seconds: still.frame / FPS }) : []));
	options.log?.(`preview: ${stills.length} stills in ${Date.now() - started} ms`);
	return { ok: true, stills: stills.map((still) => ({ t: Math.round((still.frame / FPS) * 100) / 100, file: still.file })), issues: [...new Set(issues)], estimated: timeline.estimated };
}
