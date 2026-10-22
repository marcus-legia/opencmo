/**
 * Op sinh visual giải thích (spec visuals §5 V1b–V2). Mỗi op dựng một `group`
 * phủ khung gồm rect/path/text, có mark `visual` giữ op + input — `update_visual`
 * đọc mark đó để sinh lại khi người dùng sửa nhãn hay số, giữ vị trí và thời gian.
 *
 * Toạ độ vào là chuẩn hoá 0–1 theo khung; thời gian là giây của clip.
 */

import { z } from 'zod';

import { ANIMATION_TYPES, type ClipDocument, type ClipNode } from '@opencmo/clip-doc';
import { createRenderer, FPS, type LayoutBox } from '@opencmo/clip-render';

import { byId, clone, sceneOf, type Entity } from '../doc';
import { readBrand, rebrand, themeFromBrand } from '../brand';
import { buildChart, chartInput, type ChartInput } from '../visuals/chart';
import { panelRegionAt } from '../layout';
import { clipScript, clipWords, findQuote, quoteTiming } from '../script';
import { defaultRegion, r2, toPixels, visualGroup, type Box, type Node } from '../visuals/common';
import { buildDiagram, diagramInput, type DiagramInput } from '../visuals/diagram';
import { buildGraph, ExprError, graphInput, type GraphInput } from '../visuals/graph';
import { buildIcon, IconError, iconInput, type IconInput } from '../visuals/icon';
import { buildLottie, LottieError, lottieInput, type LottieInput } from '../visuals/lottie';
import { buildShape, SHAPE_NAMES, shapeInput, type ShapeInput } from '../visuals/shape';
import { buildThree, threeInput, type ThreeInput } from '../visuals/three';
import { buildTitle, measureTitle, titleInput, titleName, titleSafe, type TitleInput } from '../visuals/title';
import { buildHook, hookArea, hookInput, type HookInput } from '../visuals/hook';
import { buildList, listInput, listItem, type ListInput } from '../visuals/list';
import { OpFailure, type OpContext } from './context';
import { loadCaptions } from './captions';
import { checked } from './project';
import { parentOrigin, timesOf } from './timeline';

const timing = {
	start: z.number().finite().min(0).optional(),
	end: z.number().finite().min(0).optional(),
	/** Câu người nói mà visual minh hoạ, chép từ kịch bản; thiếu start/end thì đặt theo câu này. */
	quote: z.string().trim().min(2).max(300).optional(),
};

type Timing = { start: number; end: number };

function frameOf(document: ClipDocument) {
	const scene = sceneOf(document);
	if (!scene || !scene.width || !scene.height) throw new OpFailure('This project has no scene to edit.');
	const workarea = scene.workarea as [number, number] | undefined;
	return { width: scene.width, height: scene.height, duration: workarea ? workarea[1] : null };
}

/** Kẹp thời gian vào clip; báo lỗi rõ khi visual nằm ngoài. */
function clamp(input: Timing, duration: number | null): Timing {
	const end = duration === null ? input.end : Math.min(input.end, duration);
	if (!(end > input.start)) throw new OpFailure('The visual must end after it starts, inside the clip.');
	return { start: input.start, end };
}

/**
 * Mốc CLIP của câu `quote` trong transcript của clip (`script.ts`). Không thấy
 * câu thì báo lỗi — visual phải gắn với điều người nói thật sự nói.
 */
export async function quoteRange(
	document: ClipDocument,
	ctx: Pick<OpContext, 'readTranscript'> | undefined,
	quote: string,
	limits: { min?: number; max?: number } = {},
): Promise<Timing> {
	const model = ctx ? await loadCaptions(document, ctx).catch(() => null) : null;
	if (!model) throw new OpFailure('This clip has no transcript to find that line in. Pass start and end instead.');
	const words = clipWords(model.transcript, model.window, model.removed);
	const hit = findQuote(words, quote);
	if (!hit) throw new OpFailure(`"${quote.slice(0, 80)}" is not in this clip's transcript. Copy the exact words from <clip_context>.`);
	return quoteTiming(hit, clipScript(words), frameOfDuration(document), limits);
}

const frameOfDuration = (document: ClipDocument): number | null => {
	const workarea = sceneOf(document)?.workarea as [number, number] | undefined;
	return workarea ? workarea[1] : null;
};

/** start/end của op: cái đã cho thắng; thiếu thì lấy từ `quote`. */
export async function resolveTiming(
	document: ClipDocument,
	ctx: Pick<OpContext, 'readTranscript'> | undefined,
	input: { start?: number; end?: number; quote?: string },
	limits?: { min?: number; max?: number },
): Promise<Timing> {
	if (input.start !== undefined && input.end !== undefined) return { start: input.start, end: input.end };
	if (!input.quote) throw new OpFailure('Give start and end (clip seconds), or quote: the words the speaker says when it should appear.');
	const found = await quoteRange(document, ctx, input.quote, limits);
	const start = input.start ?? found.start;
	return { start, end: input.end ?? Math.max(found.end, start + 1) };
}

/** Lỗi của builder (công thức sai…) thành lỗi op đọc được. */
async function built(make: () => Node[] | Promise<Node[]>): Promise<Node[]> {
	try {
		return await make();
	} catch (error) {
		if (error instanceof ExprError || error instanceof IconError || error instanceof LottieError) throw new OpFailure(error.message);
		throw error;
	}
}

type Frame = { width: number; height: number };

type Builder = {
	name: string;
	schema: z.ZodType;
	build(input: never, frame: Frame, area: Box, duration: number): Node[] | Promise<Node[]>;
	title(input: never): string;
	/** Pixel area the builder draws in, when it is not the usual region/panel (titles keep clear of captions). */
	area?(input: never, frame: Frame, document: ClipDocument, when: Timing, ctx: Pick<OpContext, 'media'> | undefined): Box;
	/** Children animate their own exit; the group does not fade on top of it. */
	ownExit?: boolean;
};

type Rect = { x0: number; y0: number; x1: number; y1: number };

function rectOf(box: LayoutBox): Rect {
	const [ox, oy, w, h] = box.box;
	const m = box.matrix;
	const points = [[ox, oy], [ox + w, oy], [ox + w, oy + h], [ox, oy + h]].map(([x, y]) => [m[0] * x! + m[2] * y! + m[4], m[1] * x! + m[3] * y! + m[5]] as const);
	const xs = points.map((point) => point[0]);
	const ys = points.map((point) => point[1]);
	return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** Caption boxes on screen while a visual is up (start, middle, end): the same boxes `check` reads. */
function captionRects(document: ClipDocument, when: Timing, ctx: Pick<OpContext, 'media'> | undefined): Rect[] {
	const renderer = createRenderer(document, {
		image: () => null,
		video: () => null,
		duration: (src) => ctx?.media?.duration(src) ?? null,
		transcript: (src) => ctx?.media?.transcript?.(src) ?? null,
	});
	const rects: Rect[] = [];
	for (const second of [when.start, (when.start + when.end) / 2, Math.max(when.start, when.end - 0.05)]) {
		for (const box of renderer.layout(Math.round(second * FPS))) {
			if (box.node.kind !== 'captions' || !box.visible || box.values.opacity <= 0 || (box.node as { hidden?: boolean }).hidden) continue;
			rects.push(rectOf(box));
		}
	}
	return rects;
}

/**
 * Where a title goes: lower thirds and name tags on the bottom of the title-safe box, moved up
 * above the captions when they would meet; with no room left in the lower part of the frame, the
 * upper safe band. Chapter titles are centred unless captions sit there.
 */
function titleArea(input: TitleInput, frame: Frame, document: ClipDocument, when: Timing, ctx: Pick<OpContext, 'media'> | undefined): Box {
	const safe = titleSafe(frame);
	const rects = captionRects(document, when, ctx);
	const { height } = measureTitle(input, frame, safe.width);
	const gap = Math.round(Math.min(frame.width, frame.height) * 0.03);
	const hits = (top: number, bottom: number) => rects.filter((rect) => rect.y0 < bottom + gap && rect.y1 > top - gap);
	const band = (top: number): Box => ({ x: safe.x, y: r2(top), width: safe.width, height: r2(height) });
	if (input.kind === 'chapter') {
		const top = safe.y + (safe.height - height) / 2;
		if (!hits(top, top + height).length) return safe;
	} else {
		let bottom = safe.y + safe.height;
		for (let guard = 0; guard < 8; guard++) {
			const found = hits(bottom - height, bottom);
			if (!found.length) break;
			bottom = Math.min(...found.map((rect) => rect.y0)) - gap;
		}
		if (bottom - height >= Math.max(safe.y, frame.height * 0.45)) return band(bottom - height);
	}
	let top = safe.y;
	for (let guard = 0; guard < 8; guard++) {
		const found = hits(top, top + height);
		if (!found.length) break;
		top = Math.max(...found.map((rect) => rect.y1)) + gap;
	}
	return band(Math.min(top, safe.y + safe.height - height));
}

const BUILDERS: Record<string, Builder> = {
	add_shape: {
		name: 'add_shape',
		schema: shapeInput,
		build: (input: ShapeInput, frame) => buildShape(input, frame),
		title: (input: ShapeInput) => SHAPE_NAMES[input.shape],
	},
	add_diagram: {
		name: 'add_diagram',
		schema: diagramInput,
		build: (input: DiagramInput, frame, area, duration) => buildDiagram(input, frame, area, duration),
		title: () => 'Diagram',
	},
	add_chart: {
		name: 'add_chart',
		schema: chartInput,
		build: (input: ChartInput, frame, area, duration) => buildChart(input, frame, area, duration),
		title: (input: ChartInput) => `${input.type[0]!.toUpperCase()}${input.type.slice(1)} chart`,
	},
	add_3d: {
		name: 'add_3d',
		schema: threeInput,
		build: (input: ThreeInput, frame, area) => buildThree(input, frame, area),
		title: () => '3D scene',
	},
	add_lottie: {
		name: 'add_lottie',
		schema: lottieInput,
		build: (input: LottieInput, frame) => buildLottie(input, frame),
		title: (input: LottieInput) => `Animation: ${input.animation.replace(/^builtin:/, '').split('/').pop()}`,
	},
	add_icon: {
		name: 'add_icon',
		schema: iconInput,
		build: (input: IconInput, frame, _area, duration) => buildIcon(input, frame, duration),
		title: (input: IconInput) => `Icon: ${input.name}`,
	},
	add_graph: {
		name: 'add_graph',
		schema: graphInput,
		build: (input: GraphInput, frame, area, duration) => buildGraph(input, frame, area, duration),
		title: (input: GraphInput) => `Graph of ${input.expr}`,
	},
	add_hook_title: {
		name: 'add_hook_title',
		schema: hookInput,
		build: (input: HookInput, _frame, area) => buildHook(input, area),
		title: () => 'Hook title',
		area: (_input: never, frame) => hookArea(frame, titleSafe(frame)),
	},
	add_list: {
		name: 'add_list',
		schema: listInput,
		build: (input: ListInput, _frame, area) => buildList(input, area),
		title: (input: ListInput) => `List of ${input.items.length}`,
	},
	add_title: {
		name: 'add_title',
		schema: titleInput,
		build: (input: TitleInput, frame, area, duration) => buildTitle(input, frame, area, duration),
		title: (input: TitleInput) => titleName(input),
		area: titleArea,
		ownExit: true,
	},
};

/** Dựng group của một visual từ op + input đã kiểm. */
async function visualNode(op: string, input: Record<string, unknown>, when: Timing, frame: Frame, document: ClipDocument, ctx: Pick<OpContext, 'media'> | undefined): Promise<Node> {
	const builder = BUILDERS[op]!;
	// Trong khoảng chia đôi, visual không nói chỗ nào thì vào panel, không đè người nói.
	const panel = panelRegionAt(document, when.start);
	const region = (input.region as Box | undefined) ?? panel ?? defaultRegion(frame);
	if (panel && (op === 'add_icon' || op === 'add_lottie') && !input.at) {
		input = { ...input, at: [r2(panel.x + panel.width / 2), r2(panel.y + panel.height / 2)] };
	}
	// Brand Kit đã áp vào clip: màu/font mặc định của builder đổi sang của kit.
	const area = builder.area ? builder.area(input as never, frame, document, when, ctx) : toPixels(region, frame);
	const children = rebrand(await built(() => builder.build(input as never, frame, area, when.end - when.start)), themeFromBrand(readBrand(document)));
	return visualGroup(builder.title(input as never), children, when, frame, { op, input }, { ownExit: builder.ownExit });
}

function addTo(document: ClipDocument, node: Node): ClipDocument {
	const next = clone(document);
	const scene = sceneOf(next)!;
	scene.children = [...(scene.children ?? []), node as never];
	return checked(next, 'That visual cannot be added');
}

/**
 * Input của op = object PHẲNG (op, start, end + trường của visual): tool của
 * agent sinh JSON schema từ đây và cần `properties` ở cấp trên cùng — một
 * `z.intersection` ra `allOf` không có. Luật chéo trường (`refine`) của module
 * chạy lại trong `superRefine`.
 */
function visualOp<T extends z.ZodObject>(name: keyof typeof BUILDERS, schema: T, describe: (input: z.infer<T>) => string, limits?: { min?: number; max?: number }) {
	return {
		name,
		input: z.object({ op: z.literal(name), ...timing, ...schema.shape }).superRefine((value, ctx) => {
			const { op: _op, start: _start, end: _end, quote: _quote, ...spec } = value as Record<string, unknown>;
			const parsed = schema.safeParse(spec);
			if (!parsed.success) for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
		}),
		describe,
		async apply(document: ClipDocument, input: z.infer<T> & { start?: number; end?: number; quote?: string; op: string }, ctx?: OpContext) {
			const frame = frameOf(document);
			const when = clamp(await resolveTiming(document, ctx, input, limits), frame.duration);
			// `quote` đi vào mark cùng input: update_visual dựng lại vẫn biết visual minh hoạ câu nào.
			const { op: _op, start: _start, end: _end, ...spec } = input as Record<string, unknown>;
			return addTo(document, await visualNode(name, spec, when, frame, document, ctx));
		},
	};
}

export const addShape = visualOp('add_shape', shapeInput, (input) => `Draw ${SHAPE_NAMES[input.shape].toLowerCase()}`);
export const addDiagram = visualOp('add_diagram', diagramInput, (input) => `Add a diagram: ${input.nodes.map((node) => node.label).slice(0, 4).join(' → ')}`);
export const addChart = visualOp('add_chart', chartInput, (input) => `Add a ${input.type} chart${input.title ? `: ${input.title}` : ''}`);
export const addGraph = visualOp('add_graph', graphInput, (input) => `Plot y = ${input.expr}`);
export const addIcon = visualOp('add_icon', iconInput, (input) => `Add the ${input.name} icon${input.motion && input.motion !== 'none' ? ` (${input.motion})` : ''}`);
// A title stays up long enough to read a name and role (5.5 s), never longer than 8 s.
export const addTitle = visualOp('add_title', titleInput, (input) => `Add a ${input.kind === 'chapter' ? 'chapter title' : input.kind === 'nameTag' ? 'name tag' : 'lower third'}: ${input.title}`, { min: 5.5, max: 8 });
/**
 * The opening hook of a talking head. Without start/end/quote it opens the clip: 0–3 s. A hook is
 * read in one glance, so it stays up 1.5–8 s.
 */
const hookOp = visualOp('add_hook_title', hookInput, (input) => `Add a hook title: ${input.lines.join(' / ')}`, { min: 1.5, max: 8 });
export const addHookTitle = {
	...hookOp,
	async apply(document: ClipDocument, input: Parameters<typeof hookOp.apply>[1], ctx?: OpContext) {
		const opening = input.start === undefined && input.end === undefined && input.quote === undefined;
		return hookOp.apply(document, opening ? { ...input, start: 0, end: 3 } : input, ctx);
	},
};
/**
 * A numbered list in the visual panel (split layouts) or the upper region. `reveal_quotes`, one per
 * item in order, light each row when the speaker reaches it; the list stays up until 2.5 s after the
 * last one.
 */
export const addList = {
	name: 'add_list' as const,
	input: z
		.object({
			op: z.literal('add_list'),
			...timing,
			items: z.array(listItem).min(2).max(7),
			/** The words that bring each row up, one per item, in order. */
			reveal_quotes: z.array(z.string().trim().min(2).max(120)).max(7).optional(),
		})
		.strict()
		.refine((input) => !input.reveal_quotes || input.reveal_quotes.length === input.items.length, { path: ['reveal_quotes'], message: 'Give one reveal quote per item, in order.' }),
	describe: (input: { items: { label: string }[] }) => `Add a list: ${input.items.map((item) => item.label).slice(0, 4).join(', ')}${input.items.length > 4 ? '…' : ''}`,
	async apply(document: ClipDocument, input: { start?: number; end?: number; quote?: string; items: ListInput['items']; reveal_quotes?: string[] }, ctx?: OpContext) {
		const frame = frameOf(document);
		let when = await resolveTiming(document, ctx, input, { min: 4, max: 12 });
		const reveals: number[] = [];
		for (const quote of input.reveal_quotes ?? []) reveals.push((await quoteRange(document, ctx, quote)).start);
		if (reveals.some((at, index) => index > 0 && at < reveals[index - 1]!)) throw new OpFailure('The reveal quotes must come in the order of the items.');
		if (reveals.length) when = { start: Math.min(when.start, reveals[0]!), end: Math.max(when.end, reveals.at(-1)! + 2.5) };
		when = clamp(when, frame.duration);
		const spec: ListInput = { items: input.items, ...(reveals.length ? { reveal_at: reveals.map((at) => Math.round((at - when.start) * 100) / 100) } : {}) };
		return addTo(document, await visualNode('add_list', spec, when, frame, document, ctx));
	},
};
export const addLottie = visualOp('add_lottie', lottieInput, (input) => `Add the ${input.animation.split('/').pop()} animation`);
// 3D phẳng vẽ CPU: agent không dùng nữa (spec code-scenes: 3D của agent là code
// three.js qua add_3d_scene). Op giữ nguyên cho document cũ và update_visual.
export const add3d = { ...visualOp('add_3d', threeInput, (input) => `Add a 3D scene (${input.objects.map((object) => object.type).join(', ')})`), agent: false as const };

// ------------------------------------------------------------------ sửa lại

/** Prop của group visual mà người dùng chỉnh bằng tay — sinh lại không được xoá. */
const KEPT_ON_UPDATE = ['name', 'x', 'y', 'offsetX', 'offsetY', 'rotation', 'scale', 'scaleX', 'scaleY', 'opacity', 'blendMode', 'hidden', 'tracks'] as const;

/** A start at 0 is written as absent (`editTime`), so a visual moved back to 0 has none. */
const startOf = (entity: Entity): number => (typeof entity.start === 'number' ? entity.start : 0);

/** The visual's own end, or where it resolves to end when it has none written. */
function endOf(document: ClipDocument, entity: Entity, ctx?: OpContext): number {
	if (typeof entity.end === 'number') return entity.end;
	const t = timesOf(document, ctx ?? {}).get(entity as unknown as ClipNode);
	if (!t) throw new OpFailure('That visual is not in the active scene.');
	return Math.round(((t.end - parentOrigin(t)) / FPS) * 1e4) / 1e4;
}

type UpdateVisual = { id: string; changes: Record<string, unknown>; start?: number; end?: number };

export const updateVisual = {
	name: 'update_visual',
	input: z.object({
		op: z.literal('update_visual'),
		id: z.string().min(1).max(64),
		/** Phần input đổi (nhãn, số, layout, màu…) — gộp nông vào input cũ. */
		changes: z.record(z.string(), z.unknown()),
		start: z.number().finite().min(0).optional(),
		end: z.number().finite().min(0).optional(),
	}),
	describe: () => 'Update a visual',
	async apply(document: ClipDocument, input: UpdateVisual, ctx?: OpContext) {
		const found = byId(document, input.id);
		const mark = (found?.entity.marks as { visual?: { op?: string; input?: Record<string, unknown> } } | undefined)?.visual;
		if (!found || found.tag !== 'group' || !mark?.op || !BUILDERS[mark.op]) {
			throw new OpFailure(`"${input.id}" is not a visual made with add_shape, add_icon, add_lottie, add_diagram, add_chart, add_graph, add_title or add_3d.`);
		}
		const builder = BUILDERS[mark.op]!;
		const merged = { ...(mark.input ?? {}), ...input.changes };
		// `quote` rides in the mark next to the builder's input; strict schemas (add_title) reject it.
		const { quote: _quote, ...spec } = merged;
		const parsed = builder.schema.safeParse(spec);
		if (!parsed.success) throw new OpFailure(parsed.error.issues[0]?.message ?? 'Those changes are not valid for this visual.');
		const frame = frameOf(document);
		const when = clamp({ start: input.start ?? startOf(found.entity), end: input.end ?? endOf(document, found.entity, ctx) }, frame.duration);
		const next = clone(document);
		const target = byId(next, input.id)!;
		const quote = typeof merged.quote === 'string' ? { quote: merged.quote } : {};
		const fresh = await visualNode(mark.op, { ...(parsed.data as Record<string, unknown>), ...quote }, when, frame, document, ctx);
		// Giữ danh tính, chỗ trong cây, và mọi thứ người dùng đã đặt trên group
		// (kéo, đổi cỡ, xoay, keyframe riêng): chỉ thay nội dung bên trong.
		const kept = Object.fromEntries(
			KEPT_ON_UPDATE.filter((key) => target.entity[key] !== undefined).map((key) => [key, target.entity[key]]),
		);
		// A style's visual stays the style's after an edit, so the next apply_style still replaces it.
		const style = (target.entity.marks as { style?: string } | undefined)?.style;
		const marks = style ? { ...(fresh.marks as object), style } : fresh.marks;
		const list = target.list!;
		list.splice(list.indexOf(target.entity), 1, { ...fresh, ...kept, ...(marks ? { marks } : {}), id: input.id } as Entity);
		return checked(next, 'That visual cannot be updated');
	},
};

// ------------------------------------------------------------------ so le

type Stagger = { element_ids: string[]; type: (typeof ANIMATION_TYPES)[number]; duration?: number; step?: number; delay?: number; phase?: 'in' | 'out' };

/**
 * Áp một preset cho nhiều phần tử với độ trễ so le — LaggedStart của manim:
 * gạch đầu dòng, ô, biểu tượng hiện lần lượt thay vì cùng lúc.
 */
export const stagger = {
	name: 'stagger',
	input: z.object({
		op: z.literal('stagger'),
		element_ids: z.array(z.string().min(1).max(64)).min(2).max(40),
		type: z.enum(ANIMATION_TYPES),
		duration: z.number().min(0.05).max(10).optional(),
		/** Giây giữa hai phần tử liền nhau. */
		step: z.number().min(0).max(10).optional(),
		/** Trễ của phần tử đầu tiên. */
		delay: z.number().min(0).max(60).optional(),
		phase: z.enum(['in', 'out']).optional(),
	}),
	describe: (input: Stagger) => `Animate ${input.element_ids.length} elements one after another`,
	async apply(document: ClipDocument, input: Stagger) {
		const next = clone(document);
		const phase = input.phase ?? 'in';
		input.element_ids.forEach((id, index) => {
			const found = byId(next, id);
			if (!found || !found.list || found.tag === 'scene') throw new OpFailure(`There is no element "${id}" in this project.`);
			const entity = found.entity;
			// Thay animation cùng pha cũ: chạy lại op không chồng hai lớp.
			const kept = ((entity.animations as Entity[] | undefined) ?? []).filter((animation) => (animation.phase ?? 'in') !== phase);
			const delay = Math.round(((input.delay ?? 0) + index * (input.step ?? 0.15)) * 100) / 100;
			entity.animations = [...kept, { type: input.type, ...(phase === 'out' ? { phase } : {}), duration: input.duration ?? 0.4, ...(delay > 0 ? { delay } : {}) }];
		});
		return checked(next, 'Those elements cannot be animated that way');
	},
};
