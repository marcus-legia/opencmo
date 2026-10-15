#!/usr/bin/env node
/**
 *   clip-motion preview <job.json> <outdir>                      → PreviewResult JSON on stdout
 *   clip-motion render  <job.json> <out.mp4> [--audio voice.mp3]  → {"frames","seconds","msPerFrame"}
 *
 * Exit codes (same meaning as clip-three): 0 ok (a preview with layout issues is still 0) ·
 * 2 bad arguments · 3 invalid job · 4 the scene code failed, last stderr line = message for the
 * agent, never retried · 1 anything else.
 *
 * Env: OPENCMO_MOTION_SCALE (0.25–1, dev only), OPENCMO_MOTION_CHROME (browser path),
 * OPENCMO_MOTION_CONCURRENCY (render concurrency, default 2).
 */

import { readFileSync } from 'node:fs';

import { parseJob, prepare } from './prepare.ts';
import { previewJob } from './preview.ts';
import { MotionCodeFailure, renderJob } from './render.ts';

const USAGE = 'usage: clip-motion preview <job.json> <outdir> | clip-motion render <job.json> <out.mp4> [--audio <voice.mp3>]\n';
const log = (line: string) => process.stderr.write(`${line}\n`);

const [command, file, out, ...rest] = process.argv.slice(2);
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
	if (command === 'preview') process.stdout.write(`${JSON.stringify({ ok: false, phase: 'job', message: parsed.message })}\n`);
	process.stderr.write(`Invalid job: ${parsed.message}\n`);
	process.exit(3);
}

try {
	if (command === 'preview') {
		const result = await previewJob(parsed.job, out, { log });
		process.stdout.write(`${JSON.stringify(result)}\n`);
		if (!result.ok) {
			process.stderr.write(`${result.message}\n`);
			process.exit(4);
		}
	} else {
		const result = await renderJob(prepare(parsed.job), out, { audio, log });
		process.stdout.write(`${JSON.stringify(result)}\n`);
	}
} catch (error) {
	if (error instanceof MotionCodeFailure) {
		process.stderr.write(`${error.message}\n`);
		process.exit(4);
	}
	process.stderr.write(`${String((error as Error).stack ?? error)}\n`);
	process.exit(1);
}
