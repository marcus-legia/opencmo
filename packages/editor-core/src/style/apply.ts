/**
 * `apply_style`: compiles an Edit Plan, under a style's preset, into ops, as ONE revision.
 *
 * Two phases. First everything is resolved without writing: the style, its preset, every quote of
 * the plan, every capture, and which capabilities are ready. Then the sub-ops run in a fixed order
 * (captions → emphasis → hook → punch-in → list → chapter transitions → proofs) on one document, so
 * Approve and Undo are one step, like `edit_video` placing its result.
 *
 * A style degrades instead of failing: a capability that is not ready lands in `unavailable`, and a
 * beat whose quote is not in the transcript (or whose sub-op refuses it) lands in `skipped` with the
 * reason. Only a wrong style name or a broken preset fails the whole op.
 *
 * A second run replaces the first: the hook, list and proof groups an earlier run left are removed
 * before the new ones are placed, emphasis is cleared before it is written, and punch-in, caption
 * and transition settings overwrite themselves.
 */

import { z } from 'zod';

import type { ClipDocument } from '@opencmo/clip-doc';
import { FPS } from '@opencmo/clip-render';
import { styleByName } from '@opencmo/skills';

import { readBrand } from '../brand';
import { readCaptionStyle } from '../captions';
import { CAPABILITIES, isReady, type Capability, type CapabilityInfo } from '../capabilities';
import { clone, nodes, walk, type Entity } from '../doc';
import { OpFailure, type OpContext } from '../ops/context';
import { timesOf } from '../ops/timeline';
import { quoteRange } from '../ops/visuals';
import { EditPlanSchema, type EditPlan } from './plan';
import { StylePresetSchema, type StylePreset } from './preset';

export const applyStyleInput = z
	.object({
		op: z.literal('apply_style'),
		/** The style skill's name, from <styles>. */
		style: z.string().trim().min(1).max(64),
		plan: EditPlanSchema,
	})
	.strict();
export type ApplyStyle = z.infer<typeof applyStyleInput>;

export type StyleReceipt = {
	applied: string[];
	skipped: { item: string; reason: string }[];
	unavailable: Capability[];
};

/** A finished or pending page capture, as `capture_status` reports it. */
export type CaptureState = { status: 'pending' | 'ready' | 'failed'; error?: string };

/** What a style's preset and plan need from outside the document. */
export type StyleContext = OpContext & {
	/** Reads a page capture of this user (`capture_page`). Missing where captures cannot be read. */
	capture?: (id: string) => Promise<CaptureState | null>;
};

export type StyleDeps = {
	/** Runs one registry op on the document (schema-checked). Throws `OpFailure` when it refuses. */
	run(document: ClipDocument, op: Record<string, unknown> & { op: string }, ctx: StyleContext): Promise<ClipDocument>;
	/** Whether the registry has this op. */
	has(op: string): boolean;
	/** The capability registry (tests pass their own). */
	capabilities?: Readonly<Record<string, CapabilityInfo>>;
	/** Looks a style up by name (tests pass their own). */
	style?(name: string): { name: string; preset?: unknown } | null;
};

/** Visual groups a style places and owns: a rerun removes them before placing new ones. */
const STYLE_VISUALS: Record<string, string> = { add_hook_title: 'hook title', add_list: 'list', add_proof: 'proof card' };

/** How close (seconds) a cut must be to a chapter's first words to carry its transition. */
const CHAPTER_CUT_TOLERANCE = 0.6;
const DEFAULT_HOOK_SECONDS = 3;
const DEFAULT_ACCENT = '#FFD400';
const DEFAULT_INK = '#111111';
const DEFAULT_PAPER = '#FFFFFF';

const short = (text: string, length = 40) => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text);
const quoted = (text: string) => `"${short(text)}"`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function captionLayers(document: ClipDocument): Entity[] {
	return nodes(document).filter((node) => node.kind === 'captions') as unknown as Entity[];
}

/** `accent`/`ink`/`paper` (and `brand`) to hex: the brand kit's accent wins over the style's. */
function palette(document: ClipDocument, preset: StylePreset) {
	const brand = readBrand(document)?.colors.accent;
	const own = preset.palette?.accent;
	const accent = own && own !== 'brand' ? own : (brand ?? DEFAULT_ACCENT);
	return { accent, ink: preset.palette?.ink ?? DEFAULT_INK, paper: preset.palette?.paper ?? DEFAULT_PAPER };
}

/** The transition boundary nearest `at` (clip seconds): the left clip of a cut in a sequence. */
function cutNear(document: ClipDocument, ctx: StyleContext, at: number): string | null {
	const times = timesOf(document, ctx);
	let best: { id: string; distance: number } | null = null;
	for (const node of nodes(document)) {
		if (node.kind !== 'sequence') continue;
		const children = ((node as unknown as Entity).children as Entity[] | undefined) ?? [];
		for (const child of children.slice(0, -1)) {
			const time = times.get(child as never);
			if (!time || typeof child.id !== 'string') continue;
			const distance = Math.abs(time.end / FPS - at);
			if (distance <= CHAPTER_CUT_TOLERANCE && (!best || distance < best.distance)) best = { id: child.id, distance };
		}
	}
	return best?.id ?? null;
}

/** Removes the visual groups an earlier style run placed; returns how many of each went. */
function removeStyleVisuals(document: ClipDocument): Record<string, number> {
	const removed: Record<string, number> = {};
	const doomed: { entity: Entity; list: Entity[] }[] = [];
	walk(document, ({ entity, list }) => {
		const op = ((entity.marks as { visual?: { op?: string } } | undefined)?.visual?.op ?? '') as string;
		if (list && Object.hasOwn(STYLE_VISUALS, op)) {
			doomed.push({ entity, list });
			removed[op] = (removed[op] ?? 0) + 1;
		}
	});
	for (const { entity, list } of doomed) {
		const index = list.indexOf(entity);
		if (index >= 0) list.splice(index, 1);
	}
	return removed;
}

type Step = {
	/** What the receipt calls it. */
	item: string;
	op: Record<string, unknown> & { op: string };
	/** The line for `applied` when it runs; empty for a step that only supports another. */
	done: string;
	/**
	 * Steps that make one visible change together (a setting on every captions layer, a transition
	 * per chapter): the receipt says it once, with the count where the count means something.
	 */
	group?: 'reveal' | 'chapters';
};

/**
 * Resolves the plan, applies it, and returns the new document with its receipt. The input document
 * is never modified.
 */
export async function runStyle(input: ClipDocument, request: ApplyStyle, ctx: StyleContext, deps: StyleDeps): Promise<{ document: ClipDocument; receipt: StyleReceipt }> {
	const registry = deps.capabilities ?? CAPABILITIES;
	const style = (deps.style ?? styleByName)(request.style);
	if (!style) throw new OpFailure(`There is no style named "${short(request.style)}". Pick one from <styles>.`);
	if (request.plan.style.trim().toLowerCase() !== style.name) {
		throw new OpFailure(`The plan is for "${short(request.plan.style)}" but the style is "${style.name}". Write the plan for the style you apply.`);
	}
	const presetParse = StylePresetSchema.safeParse(style.preset ?? {});
	if (!presetParse.success) throw new OpFailure(`The style "${style.name}" has a broken preset.`);
	const preset = presetParse.data;
	const plan: EditPlan = request.plan;

	const receipt: StyleReceipt = { applied: [], skipped: [], unavailable: [] };
	const ready = (id: Capability) => {
		const ok = isReady(id, registry) && registry[id]!.ops.every((op) => deps.has(op));
		if (!ok && !receipt.unavailable.includes(id)) receipt.unavailable.push(id);
		return ok;
	};
	const skip = (item: string, reason: string) => receipt.skipped.push({ item, reason });
	/** Clip seconds of a quote, or null (and a skipped item) when the transcript does not have it. */
	const locate = async (item: string, quote: string) => {
		try {
			return await quoteRange(input, ctx, quote);
		} catch (error) {
			if (error instanceof OpFailure) {
				skip(item, error.message);
				return null;
			}
			throw error;
		}
	};

	// ---- Resolve: nothing is written in this phase.
	const steps: Step[] = [];
	const layers = captionLayers(input);
	const colors = palette(input, preset);
	const captions = preset.captions;

	if (captions && (captions.preset !== undefined || captions.highlight !== undefined || captions.maxWords !== undefined)) {
		const current = readCaptionStyle(input);
		if (!current) skip('Caption style', 'This clip has no captions.');
		else {
			if (captions.preset !== undefined || captions.highlight !== undefined) {
				steps.push({
					item: 'Caption style',
					op: {
						op: 'set_caption_style',
						preset: captions.preset ?? current.preset,
						colors: current.colors,
						...(captions.highlight !== undefined ? { highlight: captions.highlight } : {}),
					},
					done: `Captions: ${captions.preset ?? current.preset ?? 'current'} style${captions.highlight ? `, ${captions.highlight} highlight` : captions.highlight === null ? ', no highlight' : ''}`,
				});
			}
			if (captions.maxWords !== undefined) {
				steps.push({
					item: 'Caption length',
					op: { op: 'set_caption_breaks', max_words: captions.maxWords },
					done: `Captions show at most ${plural(captions.maxWords, 'word')} at a time`,
				});
			}
		}
	}

	if (captions?.reveal && layers.length && ready('caption.reveal')) {
		for (const layer of layers) {
			if (typeof layer.id !== 'string') continue;
			steps.push({ item: 'Caption reveal', op: { op: 'set_props', element_id: layer.id, props: { reveal: captions.reveal } }, done: 'Each caption word fades in as it is spoken', group: 'reveal' });
		}
	}

	const emphasisWanted = plan.emphasis.length > 0 || layers.some((layer) => Array.isArray(layer.emphasis) && layer.emphasis.length > 0);
	if ((emphasisWanted || captions?.emphasis) && layers.length && ready('caption.emphasis')) {
		const found: string[] = [];
		for (const { quote } of plan.emphasis) if (await locate(`Emphasis ${quoted(quote)}`, quote)) found.push(quote);
		if (captions?.emphasis) {
			const look = captions.emphasis;
			const color = look.color === undefined ? undefined : look.color === 'accent' ? colors.accent : look.color === 'ink' ? colors.ink : look.color === 'paper' ? colors.paper : look.color;
			const emphasisStyle = {
				...(look.fontFamily ? { fontFamily: look.fontFamily } : {}),
				...(look.fontStyle ? { fontStyle: look.fontStyle } : {}),
				...(color ? { color } : {}),
				...(look.scale ? { scale: look.scale } : {}),
			};
			for (const layer of layers) {
				if (typeof layer.id === 'string' && Object.keys(emphasisStyle).length) {
					steps.push({ item: 'Emphasis style', op: { op: 'set_props', element_id: layer.id, props: { emphasisStyle } }, done: '' });
				}
			}
		}
		if (emphasisWanted) {
			steps.push({
				item: 'Emphasis',
				op: { op: 'emphasize_words', quotes: found, clear: true },
				done: found.length ? `Emphasis on ${plural(found.length, 'word')}: ${found.map(quoted).join(', ')}` : 'Cleared the earlier emphasis',
			});
		}
	}

	if (plan.hook && ready('title.hook')) {
		const seconds = preset.hookTitle?.seconds ?? DEFAULT_HOOK_SECONDS;
		steps.push({
			item: `Hook title ${quoted(plan.hook.lines.join(' / '))}`,
			op: { op: 'add_hook_title', lines: plan.hook.lines, start: 0, end: seconds },
			done: `Hook title: ${plan.hook.lines.map(quoted).join(' / ')}`,
		});
	}

	if (preset.speaker?.punchIn && ready('speaker.punchIn')) {
		const { scales, minShot } = preset.speaker.punchIn;
		steps.push({
			item: 'Punch-in',
			op: { op: 'punch_in', scales, min_shot: minShot },
			done: `Punch-in alternating ${scales.join('× / ')}× between cuts`,
		});
	}

	if (plan.list && ready('list.reveal')) {
		const list = plan.list;
		const item = `List of ${plural(list.items.length, 'item')}`;
		if (await locate(item, list.quote)) {
			let reveal: string[] | undefined;
			if (list.reveal?.length) {
				const found: string[] = [];
				for (const [index, entry] of list.reveal.entries()) if (await locate(`List reveal ${index + 1} ${quoted(entry.quote)}`, entry.quote)) found.push(entry.quote);
				// One reveal per item, in order: a gap would light the wrong row.
				if (found.length === list.reveal.length && found.length === list.items.length) reveal = found;
				else skip(`${item}: reveal`, 'Each item needs its own reveal quote; the rows stay lit together instead.');
			}
			steps.push({
				item,
				op: { op: 'add_list', items: list.items, quote: list.quote, ...(reveal ? { reveal_quotes: reveal } : {}) },
				done: `${item}${reveal ? ', each lit when it is mentioned' : ''}`,
			});
		}
	}

	const transition = preset.chapters?.transition;
	if (transition && plan.chapters.length && (transition !== 'whip' || ready('transition.whip'))) {
		for (const chapter of plan.chapters) {
			const item = `Chapter ${quoted(chapter.title ?? chapter.quote)}`;
			const where = await locate(item, chapter.quote);
			if (!where) continue;
			const cut = cutNear(input, ctx, where.start);
			if (!cut) {
				skip(item, 'There is no cut near the start of this chapter to put a transition on.');
				continue;
			}
			steps.push({ item, op: { op: 'set_props', element_id: cut, props: { transition: { type: transition } } }, done: `${transition} transition`, group: 'chapters' });
		}
	}

	// Both are asked, so the receipt names every capability the proofs wait for.
	if (plan.proofs.length && [ready('proof.capture'), ready('proof.card')].every(Boolean)) {
		for (const proof of plan.proofs) {
			const item = `Proof ${quoted(proof.focus)}`;
			const capture = ctx.capture ? await ctx.capture(proof.capture_id).catch(() => null) : null;
			if (!capture) {
				skip(item, ctx.capture ? 'That capture was not found.' : 'Page captures cannot be read here.');
				continue;
			}
			if (capture.status !== 'ready') {
				skip(item, capture.status === 'failed' ? `The page capture failed${capture.error ? `: ${capture.error}` : '.'}` : 'The page capture is not finished yet.');
				continue;
			}
			if (!(await locate(item, proof.quote))) continue;
			steps.push({ item, op: { op: 'add_proof', capture_id: proof.capture_id, focus: proof.focus, quote: proof.quote }, done: `Proof card on ${quoted(proof.focus)}` });
		}
	}

	// ---- Apply: one document, one revision.
	let document = clone(input);
	const removed = removeStyleVisuals(document);
	for (const [op, count] of Object.entries(removed)) receipt.applied.push(`Replaced ${plural(count, `earlier ${STYLE_VISUALS[op]}`)}`);
	const grouped = new Map<string, { done: string; count: number }>();
	for (const step of steps) {
		try {
			document = await deps.run(document, step.op, ctx);
		} catch (error) {
			if (!(error instanceof OpFailure)) throw error;
			skip(step.item, error.message);
			continue;
		}
		if (!step.group) {
			if (step.done) receipt.applied.push(step.done);
			continue;
		}
		const seen = grouped.get(step.group);
		if (seen) seen.count += 1;
		else {
			grouped.set(step.group, { done: step.done, count: 1 });
			receipt.applied.push(step.group);
		}
	}
	// Group lines keep the place of their first step.
	receipt.applied = receipt.applied.map((line) => {
		const group = grouped.get(line);
		if (!group) return line;
		return line === 'chapters' ? `${group.done} at ${plural(group.count, 'chapter')}` : group.done;
	});
	return { document, receipt };
}

/** One line for the action card and the checkpoint label. */
export function describeStyle(input: ApplyStyle): string {
	const parts = [
		input.plan.hook ? 'a hook title' : '',
		input.plan.emphasis.length ? plural(input.plan.emphasis.length, 'emphasized word') : '',
		input.plan.chapters.length ? plural(input.plan.chapters.length, 'chapter') : '',
		input.plan.proofs.length ? plural(input.plan.proofs.length, 'proof card') : '',
	].filter(Boolean);
	return `Apply the "${input.style}" style${parts.length ? ` with ${parts.join(', ')}` : ''}`;
}

/** The registry entry; `deps` comes from the registry so the op can run the other ops. */
export function styleOp(deps: StyleDeps) {
	return {
		name: 'apply_style' as const,
		input: applyStyleInput,
		describe: describeStyle,
		async apply(document: ClipDocument, input: ApplyStyle, ctx: OpContext) {
			return (await runStyle(document, input, ctx, deps)).document;
		},
	};
}
