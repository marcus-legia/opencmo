/**
 * Node side: the job's images, checked and handed to Chromium as files. Every asset arrives as a data URI made by the
 * engine's one encoder (`motion_assets` for renders, `preview_assets` for previews), so preview and render show the
 * same pixels and nothing here fetches. Chromium gets each image as a file of the bundle it already serves, not as
 * base64 in `inputProps`, which Remotion would serialize again for every still.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { MotionCodeFailure } from './errors.ts';
import { MAX_ASSET_BYTES, MAX_ASSET_EDGE, STAGED_ASSET, type MotionAsset, type MotionJob } from './job.ts';

type Kind = 'png' | 'jpeg' | 'webp';

/** The image type from its first bytes: a body is trusted for what it is, never for its Content-Type. */
export function sniffImage(bytes: Uint8Array): Kind | null {
	const at = (i: number, values: number[]) => values.every((value, j) => bytes[i + j] === value);
	if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
	if (at(0, [0xff, 0xd8, 0xff])) return 'jpeg';
	if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
	return null;
}

/** Pixel size from the header, or null when the header does not say (`checkAssets` then refuses the image). */
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
			// Fill bytes: any number of 0xFF may pad the space before a marker.
			if (marker === 0xff) {
				i++;
				continue;
			}
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
			i += 2 + view.getUint16(i + 2);
		}
	} catch {
		return null;
	}
	return null;
}

const DATA_URI = /^data:image\/(png|jpeg|webp);base64,(.*)$/s;

function decode(asset: MotionAsset): { kind: Kind; bytes: Buffer } {
	const match = DATA_URI.exec(asset.src);
	if (!match) throw new MotionCodeFailure(`Image "${asset.name}" was not prepared for the render: pick it again.`, 'job');
	const bytes = Buffer.from(match[2]!, 'base64');
	if (bytes.byteLength > MAX_ASSET_BYTES) throw new MotionCodeFailure(`Image "${asset.name}" is larger than ${MAX_ASSET_BYTES / 1_000_000} MB: pick a smaller one.`, 'job');
	const kind = sniffImage(bytes);
	if (!kind || kind !== match[1]) throw new MotionCodeFailure(`Image "${asset.name}" is not a PNG, JPEG or WebP image.`, 'job');
	return { kind, bytes };
}

/** The job with each asset's size read from its header. Throws MotionCodeFailure (phase `job`) the agent can act on. */
export function checkAssets(job: MotionJob): MotionJob {
	if (!job.assets?.length) return job;
	const assets = job.assets.map((asset) => {
		const { kind, bytes } = decode(asset);
		// An unreadable header could hide a huge canvas that Chromium would decode in full: refuse it.
		const size = imageSize(bytes, kind);
		if (!size || size.width < 1 || size.height < 1) throw new MotionCodeFailure(`Image "${asset.name}" has no readable size: pick another one.`, 'job');
		if (size.width > MAX_ASSET_EDGE || size.height > MAX_ASSET_EDGE) {
			throw new MotionCodeFailure(`Image "${asset.name}" is ${size.width}×${size.height} px, over the ${MAX_ASSET_EDGE} px limit per side.`, 'job');
		}
		return { ...asset, width: size.width, height: size.height };
	});
	return { ...job, assets };
}

export type StagedAssets = { job: MotionJob; dispose: () => void };

/**
 * Writes each data-URI asset into the bundle's public dir (`serveUrl` is the bundle folder) and points the job at it.
 * One folder per call, so concurrent jobs never share or delete each other's files; `dispose` removes it.
 */
export function stageAssets(job: MotionJob, serveUrl: string): StagedAssets {
	if (!job.assets?.some((asset) => asset.src.startsWith('data:'))) return { job, dispose: () => undefined };
	const folder = join('job-assets', randomUUID());
	const dir = join(serveUrl, 'public', folder);
	mkdirSync(dir, { recursive: true });
	try {
		const assets = job.assets.map((asset) => {
			if (!asset.src.startsWith('data:')) return asset;
			const { kind, bytes } = decode(asset);
			const file = `${asset.name}.${kind === 'jpeg' ? 'jpg' : kind}`;
			writeFileSync(join(dir, file), bytes);
			return { ...asset, src: `${STAGED_ASSET}${folder}/${file}` };
		});
		return { job: { ...job, assets }, dispose: () => rmSync(dir, { recursive: true, force: true }) };
	} catch (error) {
		rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}
