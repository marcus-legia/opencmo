import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MotionCodeFailure } from './errors.ts';
import { checkAssets, imageSize, sniffImage, stageAssets } from './job-assets.ts';
import { STAGED_ASSET, type MotionJob } from './job.ts';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const dataUri = (bytes: Uint8Array, kind = 'png') => `data:image/${kind};base64,${Buffer.from(bytes).toString('base64')}`;

const job = (src: string): MotionJob => ({
	title: 'T',
	code: 'return () => null',
	beats: [{ say: 'a' }, { say: 'b' }, { say: 'c' }],
	format: '16:9',
	duration: 15,
	seed: 0,
	assets: [{ name: 'shot', src }],
});

function failure(run: () => unknown): MotionCodeFailure {
	try {
		run();
	} catch (error) {
		expect(error).toBeInstanceOf(MotionCodeFailure);
		expect((error as MotionCodeFailure).phase).toBe('job');
		return error as MotionCodeFailure;
	}
	throw new Error('expected a failure');
}

describe('checkAssets', () => {
	it('reads the size of a data URI image from its header', () => {
		expect(checkAssets(job(dataUri(PNG))).assets).toEqual([{ name: 'shot', src: dataUri(PNG), width: 1, height: 1 }]);
	});

	it('refuses an image over 2 MB', () => {
		const big = new Uint8Array(2_000_001);
		big.set(PNG);
		expect(failure(() => checkAssets(job(dataUri(big)))).message).toContain('larger than 2 MB');
	});

	it('refuses bytes that are not the declared image type', () => {
		expect(failure(() => checkAssets(job(dataUri(new TextEncoder().encode('<html><script>x</script></html>'))))).message).toBe('Image "shot" is not a PNG, JPEG or WebP image.');
		expect(failure(() => checkAssets(job(dataUri(PNG, 'jpeg')))).message).toBe('Image "shot" is not a PNG, JPEG or WebP image.');
	});

	it('refuses an image over 4096 px a side', () => {
		const wide = Buffer.from(PNG);
		wide.writeUInt32BE(5000, 16);
		expect(failure(() => checkAssets(job(dataUri(wide)))).message).toContain('5000×1 px');
	});

	it('refuses an image whose size cannot be read', () => {
		// A JPEG whose segments end before any start-of-frame marker.
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9, 0, 0, 0, 0]);
		expect(failure(() => checkAssets(job(dataUri(jpeg, 'jpeg')))).message).toContain('no readable size');
	});

	it('refuses a URL: the engine prepares every image', () => {
		expect(failure(() => checkAssets(job('https://project.supabase.co/a.png'))).message).toContain('was not prepared');
	});
});

describe('stageAssets', () => {
	it('writes each image into the bundle public dir and removes it on dispose', () => {
		const bundle = mkdtempSync(join(tmpdir(), 'clip-motion-stage-'));
		const staged = stageAssets(job(dataUri(PNG)), bundle);
		const src = staged.job.assets![0]!.src;
		expect(src.startsWith(`${STAGED_ASSET}job-assets/`)).toBe(true);
		const file = join(bundle, 'public', src.slice(STAGED_ASSET.length));
		expect(readFileSync(file)).toEqual(PNG);
		staged.dispose();
		expect(existsSync(file)).toBe(false);
	});

	it('gives two concurrent jobs their own folders', () => {
		const bundle = mkdtempSync(join(tmpdir(), 'clip-motion-stage-'));
		const a = stageAssets(job(dataUri(PNG)), bundle);
		const b = stageAssets(job(dataUri(PNG)), bundle);
		expect(a.job.assets![0]!.src).not.toBe(b.job.assets![0]!.src);
		a.dispose();
		expect(existsSync(join(bundle, 'public', b.job.assets![0]!.src.slice(STAGED_ASSET.length)))).toBe(true);
		b.dispose();
	});
});

describe('image headers', () => {
	it('sniffs PNG, JPEG and WebP by their bytes', () => {
		expect(sniffImage(PNG)).toBe('png');
		expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
		expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
		expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBeNull();
	});

	it('reads a JPEG size past fill bytes before its start-of-frame', () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x40, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(imageSize(jpeg, 'jpeg')).toEqual({ width: 64, height: 32 });
	});
});
