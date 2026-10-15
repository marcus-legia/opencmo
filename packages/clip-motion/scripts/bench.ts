// Dev benchmark: render a frame range of a job with a given GL mode and report ms/frame.
//   node scripts/bench.ts <job.json> <from> <to> [gl] [concurrency]
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderMedia, selectComposition } from '@remotion/renderer';

import { parseJob, prepare } from '../src/prepare.ts';
import { browserExecutable, getBundle } from '../src/render.ts';

const [file, from, to, gl = 'swangle', concurrency = '2'] = process.argv.slice(2);
const parsed = parseJob(JSON.parse(readFileSync(file!, 'utf8')));
if (!parsed.ok) throw new Error(parsed.message);
const prepared = prepare(parsed.job);
const serveUrl = await getBundle();
const inputProps = { job: prepared.job, compiled: prepared.compiled, probe: false };
const chromiumOptions = { gl: gl === 'null' ? null : (gl as 'swangle') };
const composition = await selectComposition({ serveUrl, id: 'explainer', inputProps, browserExecutable: browserExecutable(), chromiumOptions });
const started = Date.now();
await renderMedia({ composition, serveUrl, codec: 'h264', inputProps, muted: true, outputLocation: join(tmpdir(), 'bench.mp4'), frameRange: [Number(from), Number(to)], concurrency: Number(concurrency), browserExecutable: browserExecutable(), chromiumOptions, logLevel: 'error' });
const frames = Number(to) - Number(from) + 1;
console.log(JSON.stringify({ gl, concurrency, frames, msPerFrame: Math.round((Date.now() - started) / frames) }));
