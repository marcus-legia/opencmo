/**
 * Stress test export cho visual nặng (diagram, chart, graph, icon) — KHÔNG chạy trong CI.
 *
 *   npx tsx packages/clip-export/scripts/stress.mts <out-dir> [visuals|mixed|plain ...]
 *     [--base <job.json có master + transcript>] [--res 720|1080] [--fps 24|25|30|50|60]
 *
 * Mỗi ca: dựng document bằng op thật của editor-core, ghi job, chạy CLI export
 * dưới `/usr/bin/time -v`, rồi báo thời gian, RAM đỉnh, số khung đen và rút
 * vài khung PNG để NHÌN. `time -v` chỉ báo RSS của tiến trình con LỚN NHẤT;
 * export mở nhiều tiến trình (đoạn song song + ffmpeg) nên script còn lấy mẫu
 * TỔNG PSS cả cây tiến trình mỗi 100 ms — con số so với trần 2 GB. Ca `mixed` cần `--base` (job có video master).
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validate, type ClipDocument } from '@opencmo/clip-doc';
import { applyOps, type Op, type OpContext } from '@opencmo/editor-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const CLI = join(ROOT, 'packages/clip-export/src/cli.ts');
const FONTS = join(ROOT, 'packages/clip-media/fonts');

const args = process.argv.slice(2);
const flag = (name: string) => {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	const [value] = args.splice(index, 2).slice(1);
	return value;
};
const base = flag('--base');
const resolution = Number(flag('--res') ?? 1080) as 720 | 1080;
// Export frame rate: 60 draws twice the frames of 30, so memory is measured at the rate shipped.
const fps = flag('--fps');
const KILL_MB = Number(flag('--kill-mb') ?? 3000);
const [outDir, ...wanted] = args;
if (!outDir) {
	process.stderr.write('dùng: stress.mts <out-dir> [visuals|mixed|plain ...] [--base job.json] [--res 720|1080]\n');
	process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const blank = (seconds: number): ClipDocument =>
	validate({
		version: 1,
		stage: { children: [{ kind: 'scene', id: 'sc', name: 'Clip', width: 1080, height: 1920, fill: '#0F172A', workarea: [0, seconds], active: true, children: [] }] },
	});

const memory = (transcript: unknown = []): OpContext =>
	({ master: { width: 1920, height: 1080 }, readTranscript: async () => transcript, saveTranscript: async () => 'assets/transcripts/stress.json' }) as unknown as OpContext;

type Node = Record<string, unknown> & { children?: Node[] };
const sceneOf = (document: ClipDocument) => document.stage.children[0] as unknown as Node;
type Case = { name: string; document: ClipDocument; media: { src: unknown; file: string }[]; transcripts: { src: string; file: string }[]; times: number[] };

/** Every built visual filling the frame, stacked for 30 seconds, no video. */
async function visualsCase(): Promise<Case> {
	const seconds = 30;
	const ops = [
		{ op: 'add_diagram', start: 0, end: seconds, region: { x: 0.02, y: 0.02, width: 0.96, height: 0.3 }, nodes: [{ label: 'Plan' }, { label: 'Build' }, { label: 'Ship' }, { label: 'Learn' }] },
		{ op: 'add_chart', start: 0, end: seconds, region: { x: 0.02, y: 0.34, width: 0.96, height: 0.3 }, type: 'bar', data: Array.from({ length: 12 }, (_, k) => ({ label: `m${k + 1}`, value: (k * 7) % 13 })) },
		{ op: 'add_graph', start: 0, end: seconds, region: { x: 0.02, y: 0.66, width: 0.96, height: 0.32 }, expr: 'sin(x) * x', x: [-10, 10] },
		...Array.from({ length: 8 }, (_, k) => ({ op: 'add_icon', start: k * 3.5, end: k * 3.5 + 4, name: 'arrow-right', at: [0.2, 0.2 + k * 0.08], to: [0.8, 0.8 - k * 0.08], bend: 0.5, motion: 'fly', orient: true })),
	] as unknown as Op[];
	const { document } = await applyOps(blank(seconds), ops, memory());
	return { name: 'visuals', document: validate(document), media: [], transcripts: [], times: [0.5, 10, 20, 29.5] };
}

async function mixedCase(): Promise<Case> {
	if (!base) throw new Error('ca mixed cần --base <job.json>');
	const job = JSON.parse(readFileSync(base, 'utf8')) as { document: ClipDocument; media: Case['media']; transcripts: Case['transcripts'] };
	const transcript = JSON.parse(readFileSync(job.transcripts[0]!.file, 'utf8'));
	// Bỏ visual cũ + layout cũ, dựng lại từ đầu.
	const start = structuredClone(job.document);
	const scene = sceneOf(start);
	scene.children = scene.children!.filter((child) => !(child.marks as Record<string, unknown> | undefined)?.visual);
	const ops = [
		{ op: 'set_layout', mode: 'full' },
		{ op: 'set_layout', mode: 'split-top', start: 1, end: 9, ratio: 0.5 },
		{ op: 'set_layout', mode: 'split-bottom', start: 9, end: 15, ratio: 0.6 },
		{ op: 'set_layout', mode: 'visual-only', start: 15, end: 18 },
		{ op: 'add_chart', start: 2, end: 8, type: 'donut', data: [{ label: 'yes', value: 7 }, { label: 'no', value: 3 }] },
		{ op: 'add_graph', start: 10, end: 14, expr: 'sin(x)', x: [-6, 6] },
		{ op: 'add_icon', start: 15.2, end: 17.8, name: 'arrow-right', at: [0.8, 0.3], to: [0.2, 0.6], bend: 0.5, motion: 'fly', orient: true },
	] as unknown as Op[];
	const { document } = await applyOps(start, ops, memory(transcript));
	return { name: 'mixed', document: validate(document), media: job.media, transcripts: job.transcripts, times: [0.5, 1.2, 5, 9, 9.2, 12, 15.2, 16.5, 18.5] };
}

/** Mốc so sánh: document gốc của `--base`, bỏ hết visual + layout. */
async function plainCase(): Promise<Case> {
	if (!base) throw new Error('ca plain cần --base <job.json>');
	const job = JSON.parse(readFileSync(base, 'utf8')) as { document: ClipDocument; media: Case['media']; transcripts: Case['transcripts'] };
	const start = structuredClone(job.document);
	const scene = sceneOf(start);
	scene.children = scene.children!.filter((child) => !(child.marks as Record<string, unknown> | undefined)?.visual);
	const { document } = await applyOps(start, [{ op: 'set_layout', mode: 'full' }] as unknown as Op[], memory());
	return { name: 'plain', document: validate(document), media: job.media, transcripts: job.transcripts, times: [5] };
}

type Result = { name: string; seconds: number; frames: number; wall: number; msPerFrame: number; rssMB: number; treeMB: number; black: number; ok: boolean; error?: string };

/** Tổng PSS (MB) của `root` và mọi hậu duệ, đọc thẳng /proc. */
function treeRss(root: number): number {
	const parent = new Map<number, number>();
	const rss = new Map<number, number>();
	for (const entry of readdirSync('/proc')) {
		if (!/^\d+$/.test(entry)) continue;
		try {
			const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
			const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
			parent.set(Number(entry), Number(fields[1]));
			// PSS, không phải RSS: thư viện dùng chung (Skia, libav) chia đều cho các
			// tiến trình thay vì cộng mỗi tiến trình một lần — gần với cgroup đếm.
			const pss = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${entry}/smaps_rollup`, 'utf8'));
			rss.set(Number(entry), Number(pss?.[1] ?? 0) / 1024);
		} catch {
			// Tiến trình vừa thoát.
		}
	}
	let total = 0;
	for (const [pid, value] of rss) {
		for (let p: number | undefined = pid; p; p = parent.get(p)) {
			if (p === root) {
				total += value;
				break;
			}
		}
	}
	return total;
}

async function run(one: Case): Promise<Result> {
	const dir = join(outDir, one.name);
	mkdirSync(dir, { recursive: true });
	const out = join(dir, `${one.name}.mp4`);
	if (fps) (one.document.stage.children[0] as { fps?: number }).fps = Number(fps);
	const job = { document: one.document, media: one.media, transcripts: one.transcripts, fonts: FONTS, out, resolution };
	const jobFile = join(dir, 'job.json');
	writeFileSync(jobFile, JSON.stringify(job));
	const child = spawn('/usr/bin/time', ['-v', 'node', CLI, 'run', jobFile], { stdio: ['ignore', 'ignore', 'pipe'] });
	let stderr = '';
	child.stderr.on('data', (chunk) => (stderr += chunk));
	let treeMB = 0;
	// Chốt an toàn: vượt KILL_MB thì giết cả cây — ca stress không được làm sập máy.
	let killed = false;
	const sampler = setInterval(() => {
		treeMB = Math.max(treeMB, treeRss(child.pid!));
		if (treeMB > KILL_MB && !killed) {
			killed = true;
			spawnSync('pkill', ['-KILL', '-P', String(child.pid)]);
			child.kill('SIGKILL');
		}
	}, 100);
	const status = await new Promise<number | null>((done) => child.on('close', done));
	clearInterval(sampler);
	const wallText = /Elapsed \(wall clock\) time.*: (?:(\d+):)?(\d+):([\d.]+)/.exec(stderr);
	const wall = wallText ? Number(wallText[1] ?? 0) * 3600 + Number(wallText[2]) * 60 + Number(wallText[3]) : NaN;
	const rssMB = Number(/Maximum resident set size \(kbytes\): (\d+)/.exec(stderr)?.[1] ?? NaN) / 1024;
	const workarea = (sceneOf(one.document).workarea as [number, number] | undefined) ?? [0, 0];
	const seconds = workarea[1] - workarea[0];
	const base = { name: one.name, seconds, wall, rssMB: Math.round(rssMB), treeMB: Math.round(treeMB) };
	if (killed) return { ...base, frames: 0, msPerFrame: NaN, black: NaN, ok: false, error: `PSS vượt ${KILL_MB} MB, đã giết` };
	if (status !== 0) return { ...base, frames: 0, msPerFrame: NaN, black: NaN, ok: false, error: stderr.split('\n').filter((line) => /Error|error/.test(line)).slice(0, 3).join(' | ') };
	const frames = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim());
	// Khung đen: nền các ca không có master là #0F172A (không đen), nên blackdetect bắt khung vẽ hỏng.
	const detect = spawnSync('ffmpeg', ['-v', 'info', '-i', out, '-vf', 'blackdetect=d=0.03:pix_th=0.02', '-an', '-f', 'null', '-'], { encoding: 'utf8' });
	const black = [...(detect.stderr ?? '').matchAll(/black_duration:([\d.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
	for (const time of one.times) {
		spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(time), '-i', out, '-frames:v', '1', '-vf', 'scale=-2:960', join(dir, `${one.name}-${time}.png`)]);
	}
	return { ...base, frames, msPerFrame: Math.round((wall * 1000) / Math.max(frames, 1)), black: Math.round(black * 30), ok: true };
}

const builders: Record<string, () => Promise<Case>> = {
	visuals: visualsCase,
	mixed: mixedCase,
	plain: plainCase,
};
const names = wanted.length ? wanted : ['visuals', ...(base ? ['mixed'] : [])];
const results: Result[] = [];
for (const name of names) {
	const build = builders[name];
	if (!build) throw new Error(`không có ca ${name}`);
	const one = await build();
	process.stderr.write(`▶ ${name}…\n`);
	const result = await run(one);
	results.push(result);
	process.stderr.write(`${JSON.stringify(result)}\n`);
}
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
console.table(results.map((r) => ({ ca: r.name, giây: r.seconds, khung: r.frames, 'wall s': r.wall, 'ms/khung': r.msPerFrame, 'RSS lớn nhất MB': r.rssMB, 'PSS cả cây MB': r.treeMB, 'khung đen': r.black, ok: r.ok, lỗi: r.error ?? '' })));
