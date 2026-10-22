import { describe, expect, it } from 'vitest';

import { inlineAssets, sniffImage } from './assets-inline.ts';
import { MotionCodeFailure } from './errors.ts';
import type { MotionJob } from './job.ts';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const ORIGIN = 'https://project.supabase.co';
const URL_OK = `${ORIGIN}/storage/v1/object/sign/media/u/shot.png?token=x`;

const job = (src: string): MotionJob => ({
	title: 'T',
	code: 'return () => null',
	beats: [{ say: 'a' }, { say: 'b' }, { say: 'c' }],
	format: '16:9',
	duration: 15,
	seed: 0,
	assets: [{ name: 'shot', src }],
});

const serve = (body: BodyInit, init: ResponseInit = {}) => {
	const calls: string[] = [];
	const fetcher = (async (url: URL | string) => {
		calls.push(String(url));
		return new Response(body, { status: 200, headers: { 'content-type': 'image/png' }, ...init });
	}) as unknown as typeof fetch;
	return { calls, fetcher };
};

async function failure(promise: Promise<unknown>): Promise<MotionCodeFailure> {
	try {
		await promise;
	} catch (error) {
		expect(error).toBeInstanceOf(MotionCodeFailure);
		expect((error as MotionCodeFailure).phase).toBe('job');
		return error as MotionCodeFailure;
	}
	throw new Error('expected a failure');
}

describe('inlineAssets', () => {
	it('inlines a PNG from the allowed origin as a data URI', async () => {
		const { calls, fetcher } = serve(PNG);
		const out = await inlineAssets(job(URL_OK), { origin: `${ORIGIN}/`, fetch: fetcher });
		expect(calls).toEqual([URL_OK]);
		expect(out.assets).toEqual([{ name: 'shot', src: `data:image/png;base64,${PNG_BASE64}`, width: 1, height: 1 }]);
	});

	it('refuses another origin', async () => {
		const { calls, fetcher } = serve(PNG);
		const error = await failure(inlineAssets(job('https://evil.example/shot.png'), { origin: ORIGIN, fetch: fetcher }));
		expect(error.message).toContain(`must come from the user's library (${ORIGIN})`);
		expect(calls).toEqual([]);
		// No origin configured: nothing is fetched at all.
		expect((await failure(inlineAssets(job(URL_OK), { origin: undefined, fetch: fetcher }))).message).toContain('no image origin');
	});

	it('refuses a 2,000,001-byte body', async () => {
		const big = new Uint8Array(2_000_001);
		big.set(PNG);
		expect((await failure(inlineAssets(job(URL_OK), { origin: ORIGIN, fetch: serve(big as Uint8Array<ArrayBuffer>).fetcher }))).message).toContain('larger than 2 MB');
		// Without a Content-Length the stream is cut at the cap.
		const stream = new ReadableStream({ start(controller) { controller.enqueue(big); controller.close(); } });
		expect((await failure(inlineAssets(job(URL_OK), { origin: ORIGIN, fetch: serve(stream).fetcher }))).message).toContain('larger than 2 MB');
	});

	it('refuses an HTML body served as image/png', async () => {
		const error = await failure(inlineAssets(job(URL_OK), { origin: ORIGIN, fetch: serve('<html><script>x</script></html>').fetcher }));
		expect(error.message).toBe('Image "shot" is not a PNG, JPEG or WebP image.');
	});

	it('refuses a failed download and an image over 4096 px a side', async () => {
		expect((await failure(inlineAssets(job(URL_OK), { origin: ORIGIN, fetch: serve(PNG, { status: 403 }).fetcher }))).message).toContain('HTTP 403');
		const wide = Buffer.from(PNG);
		wide.writeUInt32BE(5000, 16);
		expect((await failure(inlineAssets(job(URL_OK), { origin: ORIGIN, fetch: serve(wide).fetcher }))).message).toContain('5000×1 px');
	});

	it('leaves data URIs untouched', async () => {
		const input = job(`data:image/png;base64,${PNG_BASE64}`);
		const { calls, fetcher } = serve(PNG);
		expect(await inlineAssets(input, { origin: ORIGIN, fetch: fetcher })).toEqual(input);
		expect(calls).toEqual([]);
	});

	it('sniffs PNG, JPEG and WebP by their bytes', () => {
		expect(sniffImage(PNG)).toBe('png');
		expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
		expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
		expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBeNull();
	});
});
