/**
 * Keyword emphasis (style skills, B2): the words a style picks by meaning (a number, a name, a
 * promise) get the captions layer's emphasis style, whoever is speaking them.
 *
 * Quotes resolve to SOURCE seconds, the time base of removed words, and the renderer matches words
 * by their source start (`sourceStart` in clip-render). A later cut therefore never moves emphasis
 * onto other words, and removing an emphasized word simply removes it from the screen.
 */

import { z } from 'zod';

import { MAX_EMPHASIS, type ClipDocument } from '@opencmo/clip-doc';
import { sourceStart } from '@opencmo/clip-render';

import { clone, nodes, type Entity } from '../doc';
import { findQuote } from '../script';
import { isRemoved } from '../transcript';
import { loadCaptions, speechElement } from './captions';
import { OpFailure, type OpContext } from './context';
import { checked } from './project';
import { masterCaptions, speechSources } from '../captions';

type Range = { start: number; end: number };

export const emphasizeWordsInput = z
	.object({
		op: z.literal('emphasize_words'),
		element_id: speechElement,
		/** Exact words from the transcript: one to three words each, the ones to colour. */
		quotes: z.array(z.string().trim().min(1).max(60)).max(40),
		/** Clear the layer's emphasis first (a style rerun). With no quotes: remove all emphasis. */
		clear: z.boolean().optional(),
		/** Take these words OUT of the emphasis instead of adding them. */
		remove: z.boolean().optional(),
	})
	.refine((input) => input.quotes.length > 0 || input.clear, 'Give quotes to emphasize, or clear: true.');
type EmphasizeWords = z.infer<typeof emphasizeWordsInput>;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The captions layer of a speech source: the master's, or the layer linked to that video. */
function captionsLayer(document: ClipDocument, elementId: string | undefined): Entity | null {
	const source = elementId === undefined ? null : speechSources(document).find((item) => item.elementId === elementId);
	if (!source || source.master) return masterCaptions(document) as unknown as Entity | null;
	return (nodes(document).find((node) => node.kind === 'captions' && (node as { source?: string }).source === source.elementId) as unknown as Entity | undefined) ?? null;
}

/** Merges overlapping ranges, in order. */
function merged(ranges: Range[]): Range[] {
	const out: Range[] = [];
	for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
		const last = out.at(-1);
		if (last && range.start <= last.end + 0.002) last.end = Math.max(last.end, range.end);
		else out.push({ ...range });
	}
	return out;
}

export const emphasizeWords = {
	name: 'emphasize_words',
	input: emphasizeWordsInput,
	describe: (input: EmphasizeWords) => {
		const list = input.quotes.map((quote) => `"${quote.length > 30 ? `${quote.slice(0, 29)}…` : quote}"`).join(', ');
		if (!input.quotes.length) return 'Remove the caption emphasis';
		return input.remove ? `Remove the emphasis from ${list}` : `Emphasize ${list}`;
	},
	async apply(document: ClipDocument, input: EmphasizeWords, ctx: OpContext) {
		const model = await loadCaptions(document, ctx, input.element_id);
		if (!model) throw new OpFailure('This clip has no transcript to find those words in.');
		// The words on screen, in source seconds: inside the clip's window and not cut.
		const words = model.transcript
			.flatMap((segment) => segment.words)
			.filter((word) => word.end > model.window.start && word.start < model.window.end && !isRemoved(word, model.removed));
		const found: Range[] = [];
		for (const quote of input.quotes) {
			const hit = findQuote(words, quote);
			if (!hit) throw new OpFailure(`"${quote.slice(0, 80)}" is not in this clip's transcript. Copy the exact words from <clip_context>.`);
			const starts = words.filter((word) => word.start >= hit.start - 0.001 && word.end <= hit.end + 0.001).map((word) => sourceStart(word));
			if (starts.length) found.push({ start: round(Math.min(...starts)), end: round(Math.max(...starts)) });
		}
		const next = clone(document);
		const layer = captionsLayer(next, input.element_id);
		if (!layer) throw new OpFailure('This clip has no captions to emphasize.');
		const before = input.clear ? [] : ((layer.emphasis as Range[] | undefined) ?? []);
		const after = input.remove
			? before.filter((range) => !found.some((cut) => cut.start <= range.end + 0.002 && cut.end >= range.start - 0.002))
			: merged([...before, ...found]);
		if (after.length > MAX_EMPHASIS) throw new OpFailure(`A captions layer holds at most ${MAX_EMPHASIS} emphasized phrases.`);
		if (after.length) layer.emphasis = after;
		else delete layer.emphasis;
		return checked(next, 'The emphasis could not be applied');
	},
};
