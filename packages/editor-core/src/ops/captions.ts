/**
 * Op trên phụ đề và cắt bằng chữ. Mọi op ở đây đi cùng một vòng: đọc trạng
 * thái trong document → đọc transcript NGUỒN qua ctx → đổi transcript hoặc
 * danh sách khoảng xoá → lưu → ghi lại document (`writeCaptionState`).
 *
 * Từ được gọi bằng `id` (`transcript.ts`), không bằng vị trí: vị trí đổi sau
 * mỗi lần tách/gộp dòng, và một agent nói "xoá w1k4 tới w1m0" phải trúng đúng
 * những từ nó đã đọc dù người dùng vừa tách dòng ở panel.
 */

import { z } from 'zod';

import type { ClipDocument } from '@opencmo/clip-doc';

import { readCaptionState, writeCaptionState } from '../captions';
import { clone, walk, type Entity } from '../doc';
import {
	keptRanges,
	locateWord,
	mergeRanges,
	mergeWithNext,
	normalize,
	nudgeWord,
	CUT_TIGHTNESS,
	isRemoved,
	rangeAround,
	rangeOfWords,
	remapTranscript,
	restoreWords,
	setWordText,
	splitSegment,
	type Range,
	type Transcript,
	type Word,
} from '../transcript';
import { findSilences } from '../silences';
import { OpFailure, type OpContext } from './context';

export type CaptionModel = {
	/** Đường dẫn transcript NGUỒN mà `<captions>` (hoặc lượt cắt) đang dùng. */
	basePath: string;
	transcript: Transcript;
	window: Range;
	removed: Range[];
	/** The speech source this model belongs to; undefined = the default source. */
	elementId?: string;
};

/**
 * The captions state of one speech source with its source transcript; null when it has no
 * captions. Without `elementId` it is the default source, and a clip with several videos with
 * speech fails asking for one (`OpFailure`).
 */
export async function loadCaptions(
	document: ClipDocument,
	ctx: Pick<OpContext, 'readTranscript'>,
	elementId?: string,
): Promise<CaptionModel | null> {
	const state = readCaptionState(document, elementId, true);
	if (!state?.base || !state.window) return null;
	const transcript = normalize(await ctx.readTranscript(state.base));
	return { basePath: state.base, transcript, window: state.window, removed: state.removed, elementId };
}

async function requireCaptions(document: ClipDocument, ctx: OpContext, elementId: string | undefined): Promise<CaptionModel> {
	const model = await loadCaptions(document, ctx, elementId);
	if (!model) throw new OpFailure('This clip has no captions to edit.');
	return model;
}

/** Which video to cut (`speechSources`); omitted = the master, else the only video with speech. */
export const speechElement = z
	.string()
	.min(1)
	.max(40)
	.optional()
	.describe('The video to edit (element id from the speech sources). Omit for the main video, or when the clip has only one video with speech.');

/**
 * Ghi một trạng thái mới. `transcriptChanged` false thì giữ file nguồn đang
 * có — cắt thêm một từ không phải lưu lại cả transcript.
 */
export async function writeCaptions(
	document: ClipDocument,
	ctx: OpContext,
	model: CaptionModel,
	transcriptChanged: boolean,
): Promise<ClipDocument> {
	const transcript = normalize(model.transcript);
	const base = transcriptChanged ? await ctx.saveTranscript(transcript) : model.basePath;
	const cutTranscript = model.removed.length
		? await ctx.saveTranscript(remapTranscript(transcript, keptRanges(model.window, model.removed)))
		: undefined;
	try {
		return writeCaptionState(document, { elementId: model.elementId, base, removed: model.removed, cutTranscript });
	} catch (error) {
		throw new OpFailure((error as Error).message);
	}
}

function wordsById(transcript: Transcript, ids: string[]): Word[] {
	const all = transcript.flatMap((segment) => segment.words);
	const byId = new Map(all.map((word) => [word.id, word]));
	return ids.map((id) => {
		const word = byId.get(id);
		if (!word) throw new OpFailure(`The word "${id}" is not in this transcript.`);
		return word;
	});
}

function requireAt(transcript: Transcript, id: string): [number, number] {
	const at = locateWord(transcript, id);
	if (!at) throw new OpFailure(`The word "${id}" is not in this transcript.`);
	return at;
}

/**
 * Các dải LIỀN nhau trong thứ tự đọc: "xoá w1, w2, w7" là hai khoảng, không
 * phải một khoảng từ w1 tới w7 nuốt luôn w3–w6.
 */
function runs(transcript: Transcript, words: Word[]): Word[][] {
	const order = transcript.flatMap((segment) => segment.words);
	const indexes = [...new Set(words.map((word) => order.indexOf(word)))].sort((a, b) => a - b);
	const out: Word[][] = [];
	for (const index of indexes) {
		const last = out[out.length - 1];
		if (last && order.indexOf(last[last.length - 1]!) === index - 1) last.push(order[index]!);
		else out.push([order[index]!]);
	}
	return out;
}

const wordId = z.string().min(1).max(40);
const wordIds = z.array(wordId).min(1).max(2_000);

type Target = { element_id?: string };

type RemoveWords = Target & { word_ids: string[]; tightness?: keyof typeof CUT_TIGHTNESS };

export const removeWords = {
	name: 'remove_words',
	input: z.object({
		op: z.literal('remove_words'),
		element_id: speechElement,
		word_ids: wordIds,
		tightness: z
			.enum(['tight', 'balanced', 'loose'])
			.optional()
			.describe('Also cut the pauses around the words, leaving this much pause next to the words that stay: tight 0.06s, balanced 0.15s, loose 0.32s. Omit to cut only the words.'),
	}),
	describe: (input: RemoveWords) =>
		`Remove ${input.word_ids.length} ${input.word_ids.length === 1 ? 'word' : 'words'} from the video`,
	async apply(document: ClipDocument, input: RemoveWords, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		const keep = input.tightness ? CUT_TIGHTNESS[input.tightness] : null;
		// Hàng xóm là từ CÒN GIỮ gần nhất: khoảng hở đo tới chữ người xem còn nghe.
		const order = model.transcript.flatMap((segment) => segment.words);
		const alive = (word: Word) => !isRemoved(word, model.removed) && word.end > model.window.start && word.start < model.window.end;
		const neighbour = (from: number, step: 1 | -1, skip: Set<Word>): Word | null => {
			for (let index = from; index >= 0 && index < order.length; index += step) {
				const word = order[index]!;
				if (!skip.has(word) && alive(word)) return word;
			}
			return null;
		};
		const groups = runs(model.transcript, wordsById(model.transcript, input.word_ids));
		const cutting = new Set(groups.flat());
		const ranges = groups
			.map((run) => {
				if (keep === null) return rangeOfWords(run, model.window);
				const first = order.indexOf(run[0]!);
				const last = order.indexOf(run[run.length - 1]!);
				return rangeAround(run, neighbour(first - 1, -1, cutting), neighbour(last + 1, 1, cutting), model.window, keep);
			})
			.filter((range): range is Range => range !== null);
		if (!ranges.length) throw new OpFailure('Those words are outside this clip.');
		return writeCaptions(document, ctx, { ...model, removed: mergeRanges([...model.removed, ...ranges]) }, false);
	},
};

export const restoreWordsOp = {
	name: 'restore_words',
	input: z.object({ op: z.literal('restore_words'),
		element_id: speechElement, word_ids: wordIds }),
	describe: (input: Target & { word_ids: string[] }) =>
		`Restore ${input.word_ids.length} ${input.word_ids.length === 1 ? 'word' : 'words'} to the video`,
	async apply(document: ClipDocument, input: Target & { word_ids: string[] }, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		const removed = restoreWords(model.removed, wordsById(model.transcript, input.word_ids));
		if (removed.length === model.removed.length) return document;
		return writeCaptions(document, ctx, { ...model, removed }, false);
	},
};

export const restoreAll = {
	name: 'restore_all',
	input: z.object({ op: z.literal('restore_all'), element_id: speechElement }),
	describe: () => 'Restore every cut',
	async apply(document: ClipDocument, input: { element_id?: string }, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		if (!model.removed.length) return document;
		return writeCaptions(document, ctx, { ...model, removed: [] }, false);
	},
};

/**
 * Cắt những KHOẢNG thời gian nguồn bất kỳ — khoảng lặng giữa hai câu, tiếng
 * ồn không có chữ. `remove_words` chỉ cắt được chỗ có từ; khoảng lặng thì
 * không có từ nào để gọi tên. Khoảng kẹp vào cửa sổ clip, rồi gộp với các
 * khoảng đã cắt theo cùng luật (`mergeRanges`).
 */
export const removeRanges = {
	name: 'remove_ranges',
	input: z.object({
		op: z.literal('remove_ranges'),
		element_id: speechElement,
		ranges: z
			.array(z.object({ start: z.number().min(0).max(86_400), end: z.number().min(0).max(86_400) }))
			.min(1)
			.max(500),
	}),
	describe: (input: Target & { ranges: Range[] }) =>
		`Cut ${input.ranges.length} ${input.ranges.length === 1 ? 'section' : 'sections'} from the video`,
	async apply(document: ClipDocument, input: Target & { ranges: Range[] }, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		const ranges = input.ranges
			.map((range) => ({ start: Math.max(range.start, model.window.start), end: Math.min(range.end, model.window.end) }))
			.filter((range) => range.end - range.start >= 0.05);
		if (!ranges.length) throw new OpFailure('Those times are outside this clip. Times are in source seconds, as in get_transcript.');
		return writeCaptions(document, ctx, { ...model, removed: mergeRanges([...model.removed, ...ranges]) }, false);
	},
};

/**
 * Bỏ khoảng lặng (học Palmier §B1): mọi khoảng hở giữa hai từ dài ít nhất
 * `min_pause` bị cắt, chừa `padding` giây cạnh lời mỗi phía; ở đầu/cuối cửa sổ
 * clip thì không chừa (không ai cần khoảng chết ở mép clip).
 */
type RemoveSilence = Target & { min_pause?: number; padding?: number };

export const removeSilence = {
	name: 'remove_silence',
	input: z.object({
		op: z.literal('remove_silence'),
		element_id: speechElement,
		min_pause: z.number().min(0.25).max(3).optional().describe('Shortest pause to cut, seconds. Default 0.5.'),
		padding: z.number().min(0).max(0.5).optional().describe('Pause to leave next to speech on each side, seconds. Default 0.15.'),
	}),
	describe: () => 'Remove pauses',
	async apply(document: ClipDocument, input: RemoveSilence, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		const padding = input.padding ?? 0.15;
		const silences = findSilences(model, { minGap: input.min_pause ?? 0.5, keep: padding * 2 });
		const ranges = silences.map((silence) => silence.cut).filter((range): range is Range => range !== null);
		if (!ranges.length) return document;
		return writeCaptions(document, ctx, { ...model, removed: mergeRanges([...model.removed, ...ranges]) }, false);
	},
};

type EditWords = Target & { edits: Array<{ word_id: string; text: string }> };

export const editWords = {
	name: 'edit_words',
	input: z.object({
		op: z.literal('edit_words'),
		element_id: speechElement,
		edits: z.array(z.object({ word_id: wordId, text: z.string().max(200) })).min(1).max(500),
	}),
	describe: (input: EditWords) =>
		input.edits.length === 1
			? `Change a word to "${input.edits[0]!.text.trim() || '(nothing)'}"`
			: `Change ${input.edits.length} words`,
	async apply(document: ClipDocument, input: EditWords, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		let transcript = model.transcript;
		// Tìm lại vị trí sau mỗi lượt: một từ thành hai từ làm dời mọi vị trí sau nó.
		for (const edit of input.edits) transcript = setWordText(transcript, requireAt(transcript, edit.word_id), edit.text);
		return writeCaptions(document, ctx, { ...model, transcript }, true);
	},
};

export const splitLine = {
	name: 'split_line',
	input: z.object({ op: z.literal('split_line'),
		element_id: speechElement, word_id: wordId }),
	describe: () => 'Start a new caption line',
	async apply(document: ClipDocument, input: Target & { word_id: string }, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		const at = requireAt(model.transcript, input.word_id);
		if (at[1] === 0) throw new OpFailure('That word already starts a line.');
		return writeCaptions(document, ctx, { ...model, transcript: splitSegment(model.transcript, at) }, true);
	},
};

export const mergeLines = {
	name: 'merge_lines',
	input: z.object({ op: z.literal('merge_lines'),
		element_id: speechElement, word_id: wordId }),
	describe: () => 'Join two caption lines',
	async apply(document: ClipDocument, input: Target & { word_id: string }, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		const [segment] = requireAt(model.transcript, input.word_id);
		if (segment >= model.transcript.length - 1) throw new OpFailure('That is the last caption line.');
		return writeCaptions(document, ctx, { ...model, transcript: mergeWithNext(model.transcript, segment) }, true);
	},
};

type Nudge = Target & { word_id: string; edge: 'start' | 'end'; seconds: number };

export const nudgeWordOp = {
	name: 'nudge_word',
	input: z.object({
		op: z.literal('nudge_word'),
		element_id: speechElement,
		word_id: wordId,
		edge: z.enum(['start', 'end']),
		seconds: z.number().finite().min(-5).max(5),
	}),
	describe: (input: Nudge) =>
		`Move the ${input.edge} of a word ${input.seconds < 0 ? 'earlier' : 'later'} by ${Math.abs(input.seconds)}s`,
	async apply(document: ClipDocument, input: Nudge, ctx: OpContext) {
		const model = await requireCaptions(document, ctx, input.element_id);
		const at = requireAt(model.transcript, input.word_id);
		return writeCaptions(document, ctx, { ...model, transcript: nudgeWord(model.transcript, at, input.edge, input.seconds) }, true);
	},
};

type AttachTranscript = { element_id: string; src: string };

const TRANSCRIPT_PATH = /^assets\/transcripts\/[0-9a-f]{64}\.json$/;

/** The element and the nearest scene or group above it (captions live there, not inside a row). */
export function holderOf(document: ClipDocument, id: string): { element: Entity; holder: Entity } | null {
	let out: { element: Entity; holder: Entity } | null = null;
	const visit = (entity: Entity, holder: Entity | null) => {
		if (out) return;
		const next = entity.kind === 'scene' || entity.kind === 'group' ? entity : holder;
		for (const child of (entity.children as Entity[] | undefined) ?? []) {
			if (child.id === id && next) out = { element: child, holder: next };
			else visit(child, next);
		}
	};
	visit(document.stage as unknown as Entity, null);
	return out;
}

/**
 * Links a file transcript to a video on the timeline: a hidden captions layer with `source` set to
 * the video, timed like the video (as "Generate captions" times its layer), so the video can be
 * read and cut by words. The editor runs it when the file's automatic transcript is ready; showing
 * captions stays the user's choice (unhide the layer, or `add_captions`).
 */
export const attachTranscript = {
	name: 'attach_transcript',
	agent: false,
	input: z.object({
		op: z.literal('attach_transcript'),
		element_id: z.string().min(1).max(64),
		src: z.string().regex(TRANSCRIPT_PATH, 'A transcript path is assets/transcripts/<hash>.json.'),
	}),
	describe: () => 'Attach transcript',
	async apply(document: ClipDocument, input: AttachTranscript) {
		let linked = false;
		walk(document, ({ entity }) => {
			if (entity.kind === 'captions' && entity.source === input.element_id) linked = true;
		});
		if (linked) return document;
		const next = clone(document);
		const found = holderOf(next, input.element_id);
		const element = found?.element;
		const plays =
			element?.kind === 'video' ||
			(element?.kind === 'rect' && ((element.paints as Entity[] | undefined) ?? []).some((paint) => paint.type === 'video'));
		if (!found || !element || !plays) throw new OpFailure(`No video with id "${input.element_id}".`);
		const name = typeof element.name === 'string' && element.name.trim() ? element.name.trim() : 'video';
		const captions: Entity = { kind: 'captions', name: `Transcript · ${name}`, src: input.src, source: input.element_id, hidden: true };
		for (const key of ['start', 'end', 'sourceIn', 'sourceOut', 'playbackRate']) if (element[key] !== undefined) captions[key] = element[key];
		((found.holder.children as Entity[] | undefined) ??= []).push(captions);
		return next;
	},
};
