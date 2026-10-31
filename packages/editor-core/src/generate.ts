/**
 * Catalog model sinh media (spec AI Studio §7.2) cho phía TypeScript: route
 * kiểm spec (lớp 1), editor hiện giá trước khi bấm. Bản gốc là
 * `packages/contracts/ai-models.json`; SQL giữ bản sao trong `ai_models`
 * (check:api so hai bên), worker đọc file JSON đó.
 *
 * Không ts-morph, không DOM: editor import được mà không kéo cả bộ sửa TSX.
 */

import { z } from 'zod';

import catalog from '../../contracts/ai-models.json';

import { CLIP_MAX_SECONDS, ClipSceneSchema, EXPLAINER_SCENE_BYTES, ExplainerSceneSchema, sceneBytes, type ExplainerScene } from './explainer';

export type GenerationKind = 'image' | 'video' | 'voice' | 'audio';

export type AiModel = {
	id: string;
	kind: GenerationKind;
	provider: string;
	/** Id model phía provider; chỉ worker dùng. */
	providerModel?: string;
	/** Endpoint phụ theo chế độ (aggregator): `image` = ảnh→video, `edit` = ảnh có tham chiếu. Chỉ worker dùng. */
	providerModels?: Record<string, string>;
	name: string;
	description: string;
	/** `resolution`: hệ số nhân theo độ phân giải (thiếu = 1), làm tròn lên — cùng `ai_price` (SQL). */
	/**
	 * `voiceKchars`: credits per 1,000 narration characters added on top (explainers voice their own
	 * script inside the render), rounded up per started 1,000 — same as `ai_price` (SQL).
	 */
	price: { unit: 'generation' | 'second' | 'kchars' | 'explainer'; credits: number; resolution?: Record<string, number>; voiceKchars?: number };
	limits: {
		maxPromptChars: number;
		aspectRatios?: string[];
		durations?: number[];
		minSeconds?: number;
		maxSeconds?: number;
		voices?: string[];
		/** Số ảnh tham chiếu model nhận; thiếu = 0. */
		maxReferences?: number;
		/** Explainers: the spec carries `scene` (script + code ref); `prompt` is only a one-line summary. */
		scene?: boolean;
		/** Độ phân giải chọn được (ảnh/video); có thì spec nhận `resolution`. */
		resolutions?: string[];
		/** Video bắt đầu / kết thúc trên ảnh của người dùng (`startImage` / `endImage`). */
		firstFrame?: boolean;
		lastFrame?: boolean;
		/** Video có tiếng bật/tắt được (`audio`). */
		audio?: boolean;
		/**
		 * The provider's names for the start and end frame on the endpoint that takes the last frame
		 * (long take). Worker only.
		 */
		providerInputs?: { start: string; end: string };
		/** The model can make sound, but the worker always turns it off: the voice-over and music are ours. */
		silent?: boolean;
		/**
		 * Sửa video có sẵn (G2, video-to-video): spec BẮT BUỘC mang `sourceVideo` + `sourceStart`;
		 * `duration` là số giây cắt từ nguồn. Không hiện trong danh sách sinh thường.
		 */
		sourceVideo?: boolean;
		/** Upscale (G4): model `sourceVideo` không cần lời — provider gửi độ phân giải đích. */
		upscale?: boolean;
		/**
		 * Background removal: a `sourceVideo` model whose result is a stacked-alpha cut-out. Only these
		 * models may read the clip's own video (`renders:` / `sources:` refs), not just library files.
		 */
		removeBackground?: boolean;
		/** An edit model that may also read the clip's own video (`edit_video`), not just library files. */
		clipVideo?: boolean;
		/** About how many seconds one generation takes (provider's published speed); shown on cards. */
		typicalSeconds?: number;
		/** Tên tham số kích thước phía provider (chỉ worker dùng). */
		sizeParam?: string;
	};
};

export const AI_MODELS = catalog.models as AiModel[];

export const aiModel = (id: string): AiModel | undefined => AI_MODELS.find((model) => model.id === id);

/** Spec đã chuẩn hoá — đúng thứ được băm (JCS) và lưu vào `generations.spec`. */
export type GenerationSpec = {
	prompt: string;
	aspectRatio?: string;
	duration?: number;
	voice?: string;
	/** Explainer: its script and code ref — what decides the picture, so it is in the hash. */
	scene?: ExplainerScene;
	seed?: number;
	resolution?: string;
	/** Tên object trong bucket `media` của chính người dùng (`<uid>/…`); SQL kiểm chủ + tồn tại. */
	startImage?: string;
	endImage?: string;
	references?: string[];
	audio?: boolean;
	/** Video nguồn của model sửa video (tên object media) và giây bắt đầu cắt trong file đó. */
	sourceVideo?: string;
	sourceStart?: number;
	/** /video: spec hash of the shot this one continues; the worker starts it from that shot's last frame. */
	after?: string;
};

/** Tên object media của người dùng: kiểm hình dạng ở đây, chủ sở hữu + tồn tại ở SQL. */
const mediaRef = z
	.string()
	.max(500)
	.regex(/^[0-9a-f-]{36}\/[^]+$/, 'Choose an image from your media.')
	.refine((value) => !value.includes('..'), 'Choose an image from your media.');

/**
 * Schema zod của spec theo MỘT model: field nào không thuộc loại đó bị từ chối
 * (`strict`), để hai spec khác nhau không bao giờ băm ra cùng một hash chỉ vì
 * một field lạ bị bỏ qua ở lớp dưới.
 */
/** The clip's own video, or a library video: `<bucket>:<owner>/…` for the first, `<owner>/…` for the second. */
const CLIP_VIDEO_REF = /^(?:(?:renders|sources):)?[0-9a-f-]{36}\/[^]+$/;

/** Remotion explainers (`motion-explainer`): their scene is a script plus a code ref. */
export const isExplainer = (model: Pick<AiModel, 'provider'>): boolean => model.provider === 'opencmo-motion';
/** A silent motion clip (`motion-clip`): the same renderer, no voice in the catalog row. */
export const isMotionClip = (model: Pick<AiModel, 'provider' | 'limits'>): boolean => isExplainer(model) && !model.limits.voices?.length;

// Measured like SQL: a script that passes here must not fail there. Images are capped on their own
// (6 refs), so they never count against the script.
const scriptBytes = ({ assets: _assets, ...scene }: { assets?: unknown }) => sceneBytes(scene);
const explainerScene = ExplainerSceneSchema.refine((scene) => scriptBytes(scene) <= EXPLAINER_SCENE_BYTES, {
	message: 'The script is too long for one explainer. Use fewer or shorter beats.',
});
const clipScene = ClipSceneSchema.refine((scene) => scriptBytes(scene) <= EXPLAINER_SCENE_BYTES, {
	message: 'The storyboard is too long for one motion clip. Use fewer or shorter beats.',
}).refine((scene) => scene.beats.reduce((sum, beat) => sum + beat.seconds, 0) <= CLIP_MAX_SECONDS + 1e-9, {
	message: 'This motion clip is longer than 30 seconds. Shorten its beats.',
	path: ['beats'],
});

export function specSchema(model: AiModel) {
	const { limits } = model;
	const prompt = z.string().trim().min(1, 'Write a prompt first.').max(limits.maxPromptChars, `Keep the prompt under ${limits.maxPromptChars} characters.`);
	const seed = z.number().int().min(0).max(2_147_483_647).optional();
	const aspectRatio = z.enum((limits.aspectRatios ?? ['16:9']) as [string, ...string[]], {
		error: `${model.name} does not support that aspect ratio.`,
	});
	// Trường theo khả năng của model: model không khai báo thì `strict` từ chối trường đó.
	const resolution = limits.resolutions?.length
		? { resolution: z.enum(limits.resolutions as [string, ...string[]], { error: `${model.name} does not support that resolution.` }).optional() }
		: {};
	const references = (limits.maxReferences ?? 0) > 0
		? { references: z.array(mediaRef).min(1).max(limits.maxReferences!, `${model.name} takes up to ${limits.maxReferences} reference images.`).optional() }
		: {};
	switch (model.kind) {
		case 'image':
			return z.strictObject({ prompt, aspectRatio, ...resolution, ...references, seed });
		case 'video':
			return z.strictObject({
				prompt,
				aspectRatio,
				duration: z.number().int().refine((value) => (limits.durations ?? []).includes(value), {
					message: `${model.name} does not support that duration.`,
				}),
				...resolution,
				...references,
				...(limits.firstFrame ? { startImage: mediaRef.optional(), after: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid generation request.').optional() } : {}),
				...(limits.lastFrame ? { endImage: mediaRef.optional() } : {}),
				...(limits.audio ? { audio: z.boolean().optional() } : {}),
				...(limits.sourceVideo
					? {
							sourceVideo: z
								.string()
								.max(500)
								.regex(limits.removeBackground || limits.clipVideo ? CLIP_VIDEO_REF : /^[0-9a-f-]{36}\/[^]+$/, 'Choose the video to edit.')
								.refine((value) => !value.includes('..'), 'Choose the video to edit.'),
							sourceStart: z.number().finite().min(0).max(86_400),
						}
					: {}),
				...(limits.scene && isExplainer(model) ? { scene: isMotionClip(model) ? clipScene : explainerScene } : {}),
				// Explainers voice their narration in the render job: the premade voice is part of the spec.
				...(isExplainer(model) && !isMotionClip(model) ? { voice: z.enum((limits.voices ?? ['default']) as [string, ...string[]], { error: 'Choose one of the listed voices.' }) } : {}),
				seed,
			}).refine((spec) => !('after' in spec && spec.after !== undefined && 'startImage' in spec && spec.startImage !== undefined), {
				message: 'A shot that continues the previous one cannot also start from an image.',
			});
		case 'voice':
			return z.strictObject({
				prompt,
				voice: z.enum((limits.voices ?? ['default']) as [string, ...string[]], { error: 'Choose one of the listed voices.' }),
				seed,
			});
		case 'audio':
			return z.strictObject({
				prompt,
				duration: z
					.number()
					.int()
					.min(limits.minSeconds ?? 1, `Sounds are ${limits.minSeconds ?? 1} to ${limits.maxSeconds ?? 22} seconds long.`)
					.max(limits.maxSeconds ?? 22, `Sounds are ${limits.minSeconds ?? 1} to ${limits.maxSeconds ?? 22} seconds long.`),
				seed,
			});
	}
}

/** SQL `btrim(text)`: spaces only, not tabs or newlines. `String.trim` strips both and priced a voice 1× under SQL. */
// An index scan, not `/ +$/`: that regex backtracks quadratically on a long run of inner spaces.
const sqlTrim = (text: string): string => {
	let start = 0;
	let end = text.length;
	while (start < end && text[start] === ' ') start++;
	while (end > start && text[end - 1] === ' ') end--;
	return text.slice(start, end);
};
/** SQL `length(text)` counts code points; `String.length` counts UTF-16 units (an emoji is 2). */
const sqlLength = (text: string): number => [...text].length;

/**
 * Giá credit đặt trước cho một spec — cùng công thức với `ai_price()` trong
 * SQL. Worker có thể chốt thấp hơn (chi phí thật), không bao giờ cao hơn.
 */
export function priceOf(model: AiModel, spec: GenerationSpec): number {
	const base = (() => {
		switch (model.price.unit) {
			case 'generation':
				return model.price.credits;
			case 'second':
				return model.price.credits * Math.ceil(spec.duration ?? 1);
			case 'kchars':
				return model.price.credits * Math.max(1, Math.ceil(sqlLength(sqlTrim(spec.prompt)) / 1000));
			case 'explainer':
				// Integer credits per started 10 s: 0.1 per second rounds differently in JS, SQL and Python.
				return model.price.credits * Math.ceil((spec.duration ?? 0) / 10);
		}
	})();
	const factor = (spec.resolution && model.price.resolution?.[spec.resolution]) || 1;
	const scene = spec.scene as Partial<ExplainerScene> | undefined;
	const voice = model.price.voiceKchars && Array.isArray(scene?.beats)
		// Each line trimmed and joined as SQL's `string_agg(btrim(say), ' ')`, not as `narrationOf`.
		? model.price.voiceKchars * Math.max(1, Math.ceil(sqlLength(scene.beats.map((beat) => sqlTrim(beat.say)).join(' ')) / 1000))
		: 0;
	return Math.ceil(base * factor) + voice;
}
