/**
 * Catalog sinh media theo khả năng model (plan Palmier P1): cùng luật với
 * `ai_check_spec`/`ai_price` (SQL) và `validate_spec`/`price_of` (Python).
 */

import { describe, expect, it } from 'vitest';

import { aiModel, priceOf, specSchema, type AiModel } from './generate';

const model = (id: string) => aiModel(id) as AiModel;
const UID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('giá theo độ phân giải', () => {
	it('nhân hệ số rồi làm tròn lên; thiếu = 1', () => {
		expect(priceOf(model('fal-seedance'), { prompt: 'x', aspectRatio: '9:16', duration: 5, resolution: '720p' })).toBe(10);
		expect(priceOf(model('fal-seedance'), { prompt: 'x', aspectRatio: '9:16', duration: 10, resolution: '480p' })).toBe(10);
		expect(priceOf(model('fal-seedance'), { prompt: 'x', aspectRatio: '9:16', duration: 5 })).toBe(5);
		expect(priceOf(model('fal-kling'), { prompt: 'x', aspectRatio: '9:16', duration: 5 })).toBe(30);
	});
});

describe('price matches SQL ai_price', () => {
	const voice = model('fake-voice');
	const unit = priceOf(voice, { prompt: 'x', voice: 'Test A' });
	it('trims spaces only, as btrim: trailing newlines count', () => {
		expect(priceOf(voice, { prompt: 'a'.repeat(995) + '\n'.repeat(10), voice: 'Test A' })).toBe(unit * 2);
		expect(priceOf(voice, { prompt: '  ' + 'a'.repeat(1000) + '   ', voice: 'Test A' })).toBe(unit);
	});
	it('counts code points, as length(): an emoji is one character', () => {
		expect(priceOf(voice, { prompt: '😀'.repeat(1000), voice: 'Test A' })).toBe(unit);
	});
});

describe('trường theo khả năng model', () => {
	it('frame đầu/cuối chỉ ở model khai báo', () => {
		const ok = specSchema(model('fal-seedance')).safeParse({
			prompt: 'x', aspectRatio: '9:16', duration: 5, startImage: `${UID}/j/a.png`, endImage: `${UID}/j/b.png`,
		});
		expect(ok.success).toBe(true);
		expect(specSchema(model('fal-kling')).safeParse({ prompt: 'x', aspectRatio: '9:16', duration: 5, endImage: `${UID}/j/b.png` }).success).toBe(false);
	});

	it('tham chiếu có trần và phải là tên object media', () => {
		const banana = specSchema(model('fal-nano-banana'));
		expect(banana.safeParse({ prompt: 'x', aspectRatio: '1:1', references: [`${UID}/j/a.png`] }).success).toBe(true);
		expect(banana.safeParse({ prompt: 'x', aspectRatio: '1:1', references: Array(5).fill(`${UID}/j/a.png`) }).success).toBe(false);
		expect(banana.safeParse({ prompt: 'x', aspectRatio: '1:1', references: ['../secret.png'] }).success).toBe(false);
		expect(specSchema(model('gemini-image')).safeParse({ prompt: 'x', aspectRatio: '1:1', references: [`${UID}/j/a.png`] }).success).toBe(false);
	});

	it('độ phân giải ngoài danh sách bị từ chối', () => {
		expect(specSchema(model('fal-seedance')).safeParse({ prompt: 'x', aspectRatio: '9:16', duration: 5, resolution: '1080p' }).success).toBe(false);
	});
});

describe('chained shots (/video)', () => {
	it('a video model that starts from a frame takes after, but not with a start image', () => {
		const ok = { prompt: 'x', aspectRatio: '9:16', duration: 5, after: 'a'.repeat(64) };
		expect(specSchema(model('fal-seedance')).safeParse(ok).success).toBe(true);
		expect(specSchema(model('fal-seedance')).safeParse({ ...ok, after: 'nope' }).success).toBe(false);
		expect(specSchema(model('fal-seedance')).safeParse({ ...ok, startImage: `${UID}/a.png` }).success).toBe(false);
		expect(specSchema(model('fal-nano-banana')).safeParse({ prompt: 'x', aspectRatio: '1:1', after: 'a'.repeat(64) }).success).toBe(false);
	});
});

describe('sửa video (G2, video-to-video)', () => {
	it('bắt buộc video nguồn + giây bắt đầu; giá theo số giây cắt', () => {
		const edit = model('fal-kling-edit');
		const ok = { prompt: 'make it night', aspectRatio: '9:16', duration: 6, sourceVideo: `${UID}/j/clip.mp4`, sourceStart: 12.5 };
		expect(specSchema(edit).safeParse(ok).success).toBe(true);
		expect(specSchema(edit).safeParse({ ...ok, sourceVideo: undefined }).success).toBe(false);
		expect(specSchema(edit).safeParse({ ...ok, duration: 11 }).success).toBe(false);
		expect(specSchema(edit).safeParse({ ...ok, sourceVideo: '../x.mp4' }).success).toBe(false);
		expect(priceOf(edit, ok)).toBe(24);
		// Model sinh thường không nhận video nguồn.
		expect(specSchema(model('fal-kling')).safeParse({ prompt: 'x', aspectRatio: '9:16', duration: 5, sourceVideo: `${UID}/j/clip.mp4` }).success).toBe(false);
	});

	it("edit models may read the clip's own video (edit_video); upscale may not", () => {
		const ok = { prompt: 'make it night', aspectRatio: '9:16', duration: 6, sourceVideo: `renders:${UID}/clip/master/1.mp4`, sourceStart: 0 };
		expect(specSchema(model('fal-kling-edit')).safeParse(ok).success).toBe(true);
		expect(specSchema(model('fal-kling-edit')).safeParse({ ...ok, sourceVideo: `sources:${UID}/j/proxy/1/c.mp4` }).success).toBe(true);
		expect(specSchema(model('fal-kling-edit')).safeParse({ ...ok, sourceVideo: `media:${UID}/clip/master/1.mp4` }).success).toBe(false);
		const upscale = model('fal-seedvr-upscale');
		expect(specSchema(upscale).safeParse({ ...ok, prompt: 'Upscale', duration: 5, resolution: upscale.limits.resolutions![0] }).success).toBe(false);
	});
});
