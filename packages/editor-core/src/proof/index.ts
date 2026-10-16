/**
 * `add_proof` (style skills, C5): proof B-roll. When the speaker cites a number, a repo or a title,
 * the page that says it slides in, eases in on the words and marks them while the line is said.
 *
 * The page comes from a capture (`capture_page`): a screenshot plus every word's box. The op reads
 * it through `ProofContext.proofCapture` (the server reads it under the user's RLS) and places
 * `capture:<id>` as the image, which the editor and the export resolve to the owner's file.
 */

import { z } from 'zod';

import type { ClipDocument } from '@opencmo/clip-doc';

import { readBrand } from '../brand';
import { clone, nodes, sceneOf, type Entity } from '../doc';
import { panelRegionAt } from '../layout';
import { OpFailure, type OpContext } from '../ops/context';
import { checked } from '../ops/project';
import { quoteRange } from '../ops/visuals';
import { defaultRegion, r2, THEME, toPixels, visualGroup, type Node } from '../visuals/common';
import { buildCard, PROOF_MARKS } from './card';
import { closestText, findFocus, type CaptureRun } from './find';

export { closestText, findFocus, foldWord, type CaptureRun, type FocusHit } from './find';
export { buildCard, cardBox, displayUrl, PROOF_MARKS, type ProofMark } from './card';

/** The image source of a capture's screenshot in a document. */
export const CAPTURE_SRC_PREFIX = 'capture:';

/** What `add_proof` needs of a capture. */
export type ProofCapture = {
	status: 'pending' | 'ready' | 'failed';
	error?: string;
	/** The address the page was captured at (after redirects). */
	url: string;
	/** CSS pixels of the captured page. */
	width: number;
	height: number;
	runs: CaptureRun[];
};

export type ProofContext = OpContext & {
	/** This user's capture by id, with its word boxes once ready; null when there is none. */
	proofCapture?: (id: string) => Promise<ProofCapture | null>;
};

/** Seconds the card is up before the quote, so the zoom lands as the line starts. */
const LEAD = 1.4;
const ZOOM_FROM = 0.45;
const ZOOM_FOR = 0.8;
/** The card stays after the line, and at least this long after the mark. */
const AFTER_LINE = 1.2;
const AFTER_MARK = 2.5;
const MAX_SECONDS = 9;

export const addProofInput = z
	.object({
		op: z.literal('add_proof'),
		/** A ready capture from capture_page. */
		capture_id: z.string().uuid(),
		/** Words on the captured page to zoom to and mark, copied from the page. */
		focus: z.string().trim().min(1).max(120),
		/** The words the speaker says when the card shows, copied from the transcript. */
		quote: z.string().trim().min(2).max(200),
		/** How far to zoom in (1 = whole page width). */
		zoom: z.number().min(1).max(3).optional(),
		mark: z.enum(PROOF_MARKS).optional(),
	})
	.strict();
export type AddProof = z.infer<typeof addProofInput>;

const shorten = (text: string, length = 60) => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text);

async function readCapture(ctx: ProofContext | undefined, id: string): Promise<ProofCapture> {
	if (!ctx?.proofCapture) throw new OpFailure('Page captures cannot be read here. Ask the Assistant to add the proof card.');
	const capture = await ctx.proofCapture(id);
	if (!capture) throw new OpFailure('There is no page capture with that id. Capture the page with capture_page first.');
	if (capture.status === 'failed') throw new OpFailure(`That page capture failed${capture.error ? `: ${capture.error}` : '.'}`);
	if (capture.status !== 'ready') throw new OpFailure('That page capture is not finished yet. Wait for capture_status to say ready.');
	return capture;
}

/** Start times (clip seconds) of the proof cards already on the clip. */
function proofStarts(document: ClipDocument): number[] {
	return nodes(document)
		.filter((node) => (node as unknown as Entity).marks && ((node as unknown as Entity).marks as { visual?: { op?: string } }).visual?.op === 'add_proof')
		.map((node) => Number((node as unknown as Entity).start ?? 0));
}

export const addProof = {
	name: 'add_proof' as const,
	input: addProofInput,
	describe: (input: AddProof) => `Add a proof card on "${shorten(input.focus, 40)}"`,
	async apply(document: ClipDocument, input: AddProof, ctx?: ProofContext): Promise<ClipDocument> {
		const scene = sceneOf(document);
		if (!scene || !scene.width || !scene.height) throw new OpFailure('This project has no scene to edit.');
		const frame = { width: scene.width as number, height: scene.height as number };
		const duration = (scene.workarea as [number, number] | undefined)?.[1] ?? null;

		const capture = await readCapture(ctx, input.capture_id);
		const hit = findFocus(capture.runs, input.focus);
		if (!hit) {
			const closest = closestText(capture.runs, input.focus);
			throw new OpFailure(
				`"${shorten(input.focus)}" is not on the captured page.${closest ? ` The closest text on it is "${shorten(closest)}".` : ' Pick words that are on the page.'}`,
			);
		}
		const line = await quoteRange(document, ctx, input.quote);

		// Up before the line so the zoom lands as it starts; down after it, before the next card.
		const show = Math.max(0, line.start - LEAD);
		const markAt = Math.max(ZOOM_FROM + ZOOM_FOR + 0.05, line.start - show);
		let end = Math.max(line.end + AFTER_LINE, show + markAt + AFTER_MARK);
		end = Math.min(end, show + MAX_SECONDS, ...(duration !== null ? [duration] : []));
		const next = proofStarts(document).filter((start) => start > show + 0.01);
		if (next.length) end = Math.min(end, Math.min(...next) - 0.05);
		if (!(end > show + markAt)) throw new OpFailure('There is no room for a proof card here: another card or the end of the clip comes too soon.');

		const panel = panelRegionAt(document, show);
		const area = toPixels(panel ?? defaultRegion(frame), frame);
		const children = buildCard(
			{
				src: `${CAPTURE_SRC_PREFIX}${input.capture_id}`,
				url: capture.url,
				page: { width: capture.width, height: capture.height },
				focus: hit.rect,
				zoom: input.zoom ?? 1.8,
				mark: input.mark ?? 'marker',
				accent: readBrand(document)?.colors.accent ?? THEME.accent,
				times: { zoomFrom: ZOOM_FROM, zoomTo: ZOOM_FROM + ZOOM_FOR, markAt: r2(markAt) },
			},
			area,
			end - show,
		);
		const group = visualGroup('Proof card', children, { start: show, end }, frame, { op: 'add_proof', input: { ...input } }) as Node & { animations: Node[] };
		// In: slide up with a fade; out: the group's own fade.
		group.animations = [{ type: 'fade', duration: 0.3 }, { type: 'slideUp', duration: 0.35 }, ...group.animations];

		const next_ = clone(document);
		const target = sceneOf(next_)!;
		target.children = [...(target.children ?? []), group as never];
		return checked(next_, 'That proof card cannot be added');
	},
};
