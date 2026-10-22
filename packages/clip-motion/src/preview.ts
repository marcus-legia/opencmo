/** Preview: half-size stills (at the times the model chose, or beat midpoints) plus the layout report, to look at and fix. */

import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { openBrowser, renderStill, selectComposition, type HeadlessBrowser } from '@remotion/renderer';

import { MotionCodeFailure } from './errors.ts';
import { checkAssets, stageAssets } from './job-assets.ts';
import { FPS, frameSize, type MotionJob, type PreviewResult } from './job.ts';
import { buildTimeline, pairedProbes, previewFrames } from './kit/timing.ts';
import { beatIssues, jumpIssues, layoutIssues, type LaidBox } from './layout.ts';
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
		// A shared browser (serve) stays open. Closing after a failed page can reject with "Target closed".
		if (!options.browser) await browser.close({ silent: true }).catch(() => undefined);
	}
	return stills;
}

/** The Chromium a preview renders in, with the kit's offline flags. */
export function openPreviewBrowser(): Promise<HeadlessBrowser> {
	return openBrowser('chrome', { browserExecutable: browserExecutable(), chromiumOptions: CHROMIUM, logLevel: 'error' });
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
		// Layout-only samples at quarter size, kept out of the stills the Assistant looks at.
		probes = await renderStills(staged.job, compiled, probeList.map((probe) => probe.frame), join(resolve(outdir), 'probes'), { ...options, browser, scale: 0.25 });
	} catch (error) {
		if (error instanceof MotionCodeFailure) return { ok: false, phase: error.phase, message: error.message };
		throw error;
	} finally {
		if (own) await own.close({ silent: true }).catch(() => undefined);
		staged.dispose();
	}
	const issues = [...stills, ...probes]
		.sort((a, b) => a.frame - b.frame)
		.flatMap((still) => (still.boxes ? layoutIssues(still.boxes, { width, height, seconds: still.frame / FPS }, { clip: job.kind === 'clip' }) : []));
	issues.push(...beatIssues(probeList.map((probe, i) => ({ beat: probe.beat, boxes: probes[i]?.boxes ?? null }))));
	const byFrame = new Map(probes.map((probe) => [probe.frame, probe.boxes]));
	const pairs = probes.flatMap((probe) => {
		const next = byFrame.get(probe.frame + 1);
		return probe.boxes && next ? [{ seconds: probe.frame / FPS, a: probe.boxes, b: next }] : [];
	});
	issues.push(...jumpIssues(pairs, { width, height }));
	rmSync(join(resolve(outdir), 'probes'), { recursive: true, force: true });
	options.log?.(`preview: ${stills.length} stills in ${Date.now() - started} ms`);
	return { ok: true, stills: stills.map((still) => ({ t: Math.round((still.frame / FPS) * 100) / 100, file: still.file })), issues: [...new Set(issues)], estimated: timeline.estimated };
}
