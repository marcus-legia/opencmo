/**
 * Node side: the public dir of the Remotion bundle. Fonts, the Lucide icon data and the built-in Lottie
 * animations are copied into one folder, so the composition loads them from the local bundle server and a
 * scene never fetches anything from the network.
 */

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(HERE, '..', '..');

/** Published names inside the bundle, read by `src/remotion/assets.ts`. */
export const ICONS_FILE = 'icons.json';
export const LOTTIE_DIR = 'lottie';

export function fontsDir(): string {
	return resolve(process.env.OPENCMO_EDITOR_FONTS ?? join(PACKAGES, 'clip-media', 'fonts'));
}

export function iconsFile(): string {
	return resolve(process.env.OPENCMO_MOTION_ICONS ?? join(PACKAGES, 'clip-icons', 'data', 'icons.json'));
}

export function lottieDir(): string {
	return resolve(process.env.OPENCMO_MOTION_LOTTIE ?? join(PACKAGES, 'clip-media', 'lottie'));
}

function files(dir: string): string[] {
	const out: string[] = [];
	const walk = (path: string) => {
		for (const name of readdirSync(path).sort()) {
			const full = join(path, name);
			if (statSync(full).isDirectory()) walk(full);
			else out.push(full);
		}
	};
	if (existsSync(dir)) walk(dir);
	return out;
}

/** Changes when any asset is added, removed or rewritten, so the bundle cache follows it. */
export function assetsHash(): string {
	const hash = createHash('sha256');
	for (const [label, dir] of [['fonts', fontsDir()], ['lottie', lottieDir()]] as const) {
		for (const file of files(dir)) hash.update(`${label}/${relative(dir, file)}:${statSync(file).size}:${statSync(file).mtimeMs}\n`);
	}
	const icons = iconsFile();
	hash.update(`icons:${existsSync(icons) ? `${statSync(icons).size}:${statSync(icons).mtimeMs}` : 'missing'}\n`);
	return hash.digest('hex').slice(0, 16);
}

/** The assembled public dir under `cache`, built once per asset hash. */
export function publicDir(cache: string): string {
	const out = join(cache, `public-${assetsHash()}`);
	if (existsSync(join(out, ICONS_FILE))) return out;
	const staging = `${out}.${process.pid}.tmp`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	for (const file of files(fontsDir())) cpSync(file, join(staging, relative(fontsDir(), file)));
	if (!existsSync(iconsFile())) throw new Error(`Icon data not found: ${iconsFile()} (set OPENCMO_MOTION_ICONS).`);
	cpSync(iconsFile(), join(staging, ICONS_FILE));
	if (existsSync(lottieDir())) cpSync(lottieDir(), join(staging, LOTTIE_DIR), { recursive: true });
	try {
		renameSync(staging, out);
	} catch {
		// Another process assembled the same folder first.
		rmSync(staging, { recursive: true, force: true });
	}
	return out;
}
