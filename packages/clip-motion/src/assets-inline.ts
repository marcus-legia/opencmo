/**
 * Node side: turns a job's `https` image assets into data URIs before Chromium opens. Chromium runs offline (see
 * `CHROMIUM` in render.ts), so this is the only place a motion job fetches anything, and it fetches only from the
 * one origin the deploy allows (the Supabase project that signs the URLs). Final renders arrive already inlined by
 * the worker; previews carry short-lived signed URLs.
 */

import { MotionCodeFailure } from './errors.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_EDGE, type MotionAsset, type MotionJob } from './job.ts';

type Kind = 'png' | 'jpeg' | 'webp';

/** The image type from its first bytes: a body is trusted for what it is, never for its Content-Type. */
export function sniffImage(bytes: Uint8Array): Kind | null {
	const at = (i: number, values: number[]) => values.every((value, j) => bytes[i + j] === value);
	if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
	if (at(0, [0xff, 0xd8, 0xff])) return 'jpeg';
	if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
	return null;
}

/** Pixel size from the header, or null when the header does not say (then the edge check is skipped). */
export function imageSize(bytes: Uint8Array, kind: Kind): { width: number; height: number } | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	try {
		if (kind === 'png') return { width: view.getUint32(16), height: view.getUint32(20) };
		if (kind === 'webp') {
			const chunk = String.fromCharCode(...bytes.subarray(12, 16));
			if (chunk === 'VP8X') return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(27, true) & 0xffffff) };
			if (chunk === 'VP8L') {
				const bits = view.getUint32(21, true);
				return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
			}
			if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
			return null;
		}
		// JPEG: walk the segments to the first start-of-frame marker.
		let i = 2;
		while (i + 9 < bytes.length) {
			if (bytes[i] !== 0xff) return null;
			const marker = bytes[i + 1]!;
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
			i += 2 + view.getUint16(i + 2);
		}
	} catch {
		return null;
	}
	return null;
}

async function readCapped(response: Response, name: string): Promise<Uint8Array> {
	const tooBig = () => new MotionCodeFailure(`Image "${name}" is larger than ${MAX_ASSET_BYTES / 1_000_000} MB: pick a smaller one.`, 'job');
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) throw tooBig();
	if (!response.body) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = response.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_ASSET_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw tooBig();
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

async function inlineOne(asset: MotionAsset, allowed: string | null, fetcher: typeof fetch): Promise<MotionAsset> {
	if (asset.src.startsWith('data:')) return asset;
	let url: URL;
	try {
		url = new URL(asset.src);
	} catch {
		throw new MotionCodeFailure(`Image "${asset.name}" has an invalid URL.`, 'job');
	}
	// Exact origin, scheme included: the local stack's http://127.0.0.1:54321 matches only itself.
	if (!allowed || url.origin !== allowed) {
		throw new MotionCodeFailure(`Image "${asset.name}" must come from the user's library (${allowed ?? 'no image origin is set on this server'}); other origins are refused.`, 'job');
	}
	let response: Response;
	try {
		// No redirects: a redirect could leave the allowed origin.
		response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
	} catch {
		throw new MotionCodeFailure(`Image "${asset.name}" could not be downloaded: pick it again.`, 'job');
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined);
		throw new MotionCodeFailure(`Image "${asset.name}" could not be downloaded (HTTP ${response.status}): pick it again.`, 'job');
	}
	const bytes = await readCapped(response, asset.name);
	const kind = sniffImage(bytes);
	if (!kind) throw new MotionCodeFailure(`Image "${asset.name}" is not a PNG, JPEG or WebP image.`, 'job');
	const size = imageSize(bytes, kind);
	if (size && (size.width > MAX_ASSET_EDGE || size.height > MAX_ASSET_EDGE)) {
		throw new MotionCodeFailure(`Image "${asset.name}" is ${size.width}×${size.height} px, over the ${MAX_ASSET_EDGE} px limit per side.`, 'job');
	}
	return {
		name: asset.name,
		src: `data:image/${kind};base64,${Buffer.from(bytes).toString('base64')}`,
		...(size ? { width: size.width, height: size.height } : asset.width && asset.height ? { width: asset.width, height: asset.height } : {}),
	};
}

/** The job with every asset as a data URI. Throws MotionCodeFailure (phase `job`) with a sentence the agent can act on. */
export async function inlineAssets(job: MotionJob, options: { origin: string | undefined; fetch?: typeof fetch }): Promise<MotionJob> {
	if (!job.assets?.length) return job;
	let allowed: string | null = null;
	if (options.origin) {
		try {
			allowed = new URL(options.origin).origin;
		} catch {
			allowed = null;
		}
	}
	const fetcher = options.fetch ?? fetch;
	const assets = await Promise.all(job.assets.map((asset) => inlineOne(asset, allowed, fetcher)));
	return { ...job, assets };
}

/** The image origin the deploy allows (`OPENCMO_MOTION_ASSET_ORIGIN`), read once per process. */
export const ASSET_ORIGIN = process.env.OPENCMO_MOTION_ASSET_ORIGIN;
