/**
 * Node side of clip-motion: bundle the Remotion entry once, then render jobs with the scene code
 * passed through `inputProps`, so a new job never rebundles.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, type ChromiumOptions } from '@remotion/renderer';

import { MotionCodeFailure, SCENE_ERROR_MARKER } from './errors.ts';
import { FPS, type MotionJob } from './job.ts';

export { MotionCodeFailure };

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, 'remotion', 'index.ts');
const COMPOSITION = 'explainer';

export type Log = (line: string) => void;

export type RenderOptions = {
	/** Narration muxed into the MP4 (mp3, wav or m4a). */
	audio?: string;
	/** 0.25–1, dev only: the job hash does not know about it. */
	scale?: number;
	concurrency?: number;
	log?: Log;
};

export type RenderResult = { frames: number; seconds: number; msPerFrame: number };

export function cacheDir(): string {
	const dir = process.env.OPENCMO_MOTION_CACHE ?? join(tmpdir(), 'opencmo-motion');
	mkdirSync(dir, { recursive: true });
	return dir;
}

function fontsDir(): string {
	return resolve(process.env.OPENCMO_EDITOR_FONTS ?? join(HERE, '..', '..', 'clip-media', 'fonts'));
}

function sourceHash(): string {
	const hash = createHash('sha256');
	const walk = (dir: string) => {
		for (const name of readdirSync(dir).sort()) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) hash.update(path.slice(HERE.length)).update(readFileSync(path));
		}
	};
	walk(HERE);
	hash.update(fontsDir());
	hash.update(JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).dependencies.remotion);
	return hash.digest('hex').slice(0, 16);
}

let bundled: Promise<string> | null = null;

/** Webpack bundle of the composition, cached on disk by a hash of the sources. */
export function getBundle(log?: Log): Promise<string> {
	bundled ??= (async () => {
		const out = join(cacheDir(), `bundle-${sourceHash()}`);
		if (existsSync(join(out, 'index.html'))) return out;
		const started = Date.now();
		const staging = `${out}.${process.pid}.tmp`;
		rmSync(staging, { recursive: true, force: true });
		await bundle({ entryPoint: ENTRY, outDir: staging, publicDir: fontsDir(), enableCaching: false });
		try {
			renameSync(staging, out);
		} catch {
			// Another process installed the same bundle first.
			rmSync(staging, { recursive: true, force: true });
		}
		log?.(`bundled in ${Date.now() - started} ms`);
		return out;
	})();
	return bundled;
}

/** Chromium flags from clip-three: no background traffic, no network outside the bundle server. */
const QUIET = ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-default-apps'];
const OFFLINE = [
	'--proxy-server=http://127.0.0.1:9',
	'--proxy-bypass-list=<-loopback>;localhost;127.0.0.1',
	'--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1',
	'--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
];

function findHeadlessShell(): string | null {
	const root = '/opt/pw-browsers';
	if (!existsSync(root)) return null;
	for (const name of readdirSync(root).sort().reverse()) {
		const path = join(root, name, 'chrome-linux', 'headless_shell');
		if (name.startsWith('chromium_headless_shell-') && existsSync(path)) return path;
	}
	return null;
}

/**
 * Remotion does not take extra Chromium switches, so we launch through a wrapper that appends
 * them; a later switch overrides Remotion's own `--proxy-server`.
 */
export function browserExecutable(): string | null {
	const chrome = process.env.OPENCMO_MOTION_CHROME ?? findHeadlessShell();
	if (!chrome) return null;
	const flags = [...QUIET, ...OFFLINE].map((flag) => `'${flag.replaceAll("'", `'\\''`)}'`).join(' ');
	const script = `#!/bin/sh\nexec '${chrome.replaceAll("'", `'\\''`)}' "$@" ${flags}\n`;
	const path = join(cacheDir(), `chrome-${createHash('sha256').update(script).digest('hex').slice(0, 12)}.sh`);
	if (!existsSync(path)) {
		writeFileSync(`${path}.tmp`, script);
		chmodSync(`${path}.tmp`, 0o755);
		renameSync(`${path}.tmp`, path);
	}
	return path;
}

const GL_MODES = ['angle', 'angle-egl', 'egl', 'swangle', 'swiftshader', 'vulkan'] as const;
type GlMode = (typeof GL_MODES)[number];
const glEnv = process.env.OPENCMO_MOTION_GL as GlMode | undefined;

/** `angle` measured 117 ms/frame vs 600 for `swangle` on 4 CPUs without a GPU (showcase, 1080p). */
export const CHROMIUM: ChromiumOptions = { gl: glEnv && GL_MODES.includes(glEnv) ? glEnv : 'angle' };

export function envScale(): number {
	const scale = Number(process.env.OPENCMO_MOTION_SCALE);
	return Number.isFinite(scale) && scale > 0 ? Math.min(1, Math.max(0.25, scale)) : 1;
}

export function envConcurrency(): number {
	const value = Number(process.env.OPENCMO_MOTION_CONCURRENCY);
	return Number.isInteger(value) && value > 0 ? Math.min(value, 8) : 2;
}

export function sceneFailure(error: unknown): MotionCodeFailure | null {
	const message = String((error as Error)?.message ?? error);
	const at = message.indexOf(SCENE_ERROR_MARKER);
	if (at === -1) return null;
	const rest = message.slice(at + SCENE_ERROR_MARKER.length).trim();
	return new MotionCodeFailure(rest.split('\n')[0] ?? rest, 'render');
}

export type Prepared = { job: MotionJob; compiled: string | null };

export async function renderJob(prepared: Prepared, out: string, options: RenderOptions = {}): Promise<RenderResult> {
	const log = options.log;
	const serveUrl = await getBundle(log);
	const inputProps = { job: prepared.job, compiled: prepared.compiled, probe: false };
	const executable = browserExecutable();
	const composition = await selectComposition({ serveUrl, id: COMPOSITION, inputProps, browserExecutable: executable, chromiumOptions: CHROMIUM, logLevel: 'error' });
	const video = options.audio ? join(cacheDir(), `video-${process.pid}-${Date.now()}.mp4`) : out;
	const started = Date.now();
	let lastLogged = -1;
	try {
		await renderMedia({
			composition,
			serveUrl,
			codec: 'h264',
			pixelFormat: 'yuv420p',
			outputLocation: video,
			inputProps,
			muted: true,
			concurrency: options.concurrency ?? envConcurrency(),
			scale: options.scale ?? envScale(),
			browserExecutable: executable,
			chromiumOptions: CHROMIUM,
			timeoutInMilliseconds: 30_000,
			logLevel: 'error',
			onProgress: ({ progress }) => {
				const step = Math.floor(progress * 10);
				if (step !== lastLogged) {
					lastLogged = step;
					log?.(`progress ${step * 10}%`);
				}
			},
		});
		if (options.audio) await muxAudio(video, options.audio, out, composition.durationInFrames / FPS);
	} catch (error) {
		throw sceneFailure(error) ?? error;
	} finally {
		if (options.audio) rmSync(video, { force: true });
	}
	const ms = Date.now() - started;
	return { frames: composition.durationInFrames, seconds: composition.durationInFrames / FPS, msPerFrame: Math.round(ms / composition.durationInFrames) };
}

const AUDIO_FORMATS: Record<string, string> = { '.mp3': 'mp3', '.wav': 'wav', '.m4a': 'mov', '.aac': 'aac' };

/** Audio is read with an explicit demuxer (CLAUDE.md rule 7). Longer narration is cut at the video end. */
function muxAudio(video: string, audio: string, out: string, seconds: number): Promise<void> {
	const format = AUDIO_FORMATS[extname(audio).toLowerCase()];
	if (!format) return Promise.reject(new Error(`Unsupported audio file: ${audio} (use .mp3, .wav, .m4a or .aac).`));
	const args = [
		'-hide_banner', '-loglevel', 'error', '-y',
		'-i', video,
		'-f', format, '-i', audio,
		'-map', '0:v:0', '-map', '1:a:0',
		'-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
		'-t', seconds.toFixed(3), '-movflags', '+faststart', out,
	];
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.env.FFMPEG ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let stderr = '';
		child.stderr.on('data', (chunk) => (stderr += chunk));
		child.on('error', reject);
		child.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg mux failed (${code}): ${stderr.trim()}`))));
	});
}
