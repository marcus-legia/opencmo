#!/usr/bin/env node
/**
 *   clip-motion preview <job.json> <outdir>                      → PreviewResult JSON on stdout
 *   clip-motion render  <job.json> <out.mp4> [--audio voice.mp3]  → {"frames","seconds","msPerFrame"}
 *   clip-motion serve                                            → {"ready":true}, then one PreviewResult line
 *                                                                  per stdin line {"job": MotionJob, "outdir": "…"}
 *
 * `serve` keeps one Chromium and the bundle open for many previews (the Modal preview container). A broken job
 * or scene comes back as `ok: false` and the loop goes on; it reopens the browser if it died, exits 0 on stdin
 * EOF, and exits 1 on any other failure (the caller starts a new process).
 *
 * Exit codes (same meaning as clip-three): 0 ok (a preview with layout issues is still 0) ·
 * 2 bad arguments · 3 invalid job · 4 the scene code failed, last stderr line = message for the
 * agent, never retried · 1 anything else.
 *
 * Env: OPENCMO_MOTION_SCALE (0.25–1, dev only), OPENCMO_MOTION_CHROME (browser path),
 * OPENCMO_MOTION_CONCURRENCY (render concurrency, default 2). Image assets arrive as data URIs: the CLI fetches
 * nothing (the engine's `preview_assets` / `motion_assets` download and encode them).
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import type { HeadlessBrowser } from '@remotion/renderer';

import { checkAssets } from './job-assets.ts';
import { parseJob, prepare } from './prepare.ts';
import { openPreviewBrowser, previewJob } from './preview.ts';
import { afterSceneError, getBundle, isTargetClosed, MotionCodeFailure, renderJob } from './render.ts';

// After a scene error, closing the browser can leave Remotion's "Target closed" rejection unhandled; it must not
// crash the process before the scene's message reaches stdout. Without a scene error, "Target closed" means
// Chromium died: fail at once so the worker does not wait for its timeout.
process.on('unhandledRejection', (error) => {
	if (isTargetClosed(error) && afterSceneError()) return;
	process.stderr.write(`Unhandled rejection: ${String((error as Error)?.stack ?? error)}\n`);
	process.exit(1);
});

// stdout carries exactly one JSON line; Remotion prints browser console lines to stdout, so
// everything else goes to stderr.
const stdout = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
const emit = (value: unknown) => stdout(`${JSON.stringify(value)}\n`);

const USAGE = 'usage: clip-motion preview <job.json> <outdir> | clip-motion render <job.json> <out.mp4> [--audio <voice.mp3>] | clip-motion serve\n';
const log = (line: string) => process.stderr.write(`${line}\n`);

const [command, file, out, ...rest] = process.argv.slice(2);

if (command === 'serve') {
	if (file !== undefined) {
		process.stderr.write(USAGE);
		process.exit(2);
	}
	await serve();
	process.exit(0);
}

async function serve(): Promise<void> {
	await getBundle(log);
	let browser: HeadlessBrowser = await openPreviewBrowser();
	emit({ ready: true });
	for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
		if (!line.trim()) continue;
		let request: { job?: unknown; outdir?: unknown };
		try {
			request = JSON.parse(line);
		} catch {
			emit({ ok: false, phase: 'job', message: 'The preview request is not valid JSON.' });
			continue;
		}
		if (typeof request.outdir !== 'string' || !request.outdir) {
			emit({ ok: false, phase: 'job', message: 'The preview request needs an outdir.' });
			continue;
		}
		const parsed = parseJob(request.job);
		if (!parsed.ok) {
			emit({ ok: false, phase: 'job', message: parsed.message });
			continue;
		}
		try {
			emit(await previewJob(parsed.job, request.outdir, { log, browser }));
		} catch (error) {
			// The browser may have died under the page: reopen it once and try this preview again.
			log(`serve: preview failed, reopening the browser: ${String((error as Error)?.message ?? error)}`);
			await browser.close({ silent: true }).catch(() => undefined);
			browser = await openPreviewBrowser();
			emit(await previewJob(parsed.job, request.outdir, { log, browser }));
		}
	}
	await browser.close({ silent: true }).catch(() => undefined);
}
let audio: string | undefined;
if (rest.length) {
	if (command !== 'render' || rest[0] !== '--audio' || !rest[1] || rest.length !== 2) {
		process.stderr.write(USAGE);
		process.exit(2);
	}
	audio = rest[1];
}
if ((command !== 'preview' && command !== 'render') || !file || !out) {
	process.stderr.write(USAGE);
	process.exit(2);
}

let input: unknown;
try {
	input = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
	process.stderr.write(`Cannot read the job file: ${(error as Error).message}\n`);
	process.exit(command === 'preview' ? 3 : 2);
}

const parsed = parseJob(input);
if (!parsed.ok) {
	if (command === 'preview') emit({ ok: false, phase: 'job', message: parsed.message });
	process.stderr.write(`Invalid job: ${parsed.message}\n`);
	process.exit(3);
}

try {
	if (command === 'preview') {
		const result = await previewJob(parsed.job, out, { log });
		emit(result);
		if (!result.ok) {
			process.stderr.write(`${result.message}\n`);
			process.exit(4);
		}
	} else {
		const result = await renderJob(prepare(checkAssets(parsed.job)), out, { audio, log });
		emit(result);
	}
} catch (error) {
	if (error instanceof MotionCodeFailure) {
		process.stderr.write(`${error.message}\n`);
		process.exit(4);
	}
	process.stderr.write(`${String((error as Error).stack ?? error)}\n`);
	process.exit(1);
}
