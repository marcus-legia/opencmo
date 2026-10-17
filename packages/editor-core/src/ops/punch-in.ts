/**
 * `punch_in` (style skills, B5): the alternating zoom of a talking head. Each cut piece of the
 * speaker takes the next of two scales, so every cut reads as a camera change. A piece shorter
 * than `min_shot` keeps the scale before it: a flicker between two zooms reads as a glitch.
 *
 * Every piece is its own node, so the zoom is a `scale` on the piece, pulled toward the face:
 * the face sits `(focus − 0.5) × width` from the box centre, and `offsetX = (focus − 0.5) × width ×
 * (1 − scale)` keeps it where it was. That offset never exceeds the margin the scale adds
 * (`(scale − 1) × width / 2`), so the zoomed picture still covers the frame. Rerunning replaces
 * the earlier punch-in; `scales: [1, 1]` removes it.
 */

import { z } from 'zod';

import type { ClipDocument } from '@opencmo/clip-doc';

import { clone, nodes, sceneOf, type Entity } from '../doc';
import { round } from '../transcript';
import { OpFailure } from './context';
import { checked } from './project';

const scale = z.number().min(1).max(1.5);

export const punchInInput = z
	.object({
		op: z.literal('punch_in'),
		/** The two zooms that alternate between cuts: [wide, close]. */
		scales: z.tuple([scale, scale]).default([1, 1.15]),
		/** Shots shorter than this (seconds) keep the zoom before them. */
		min_shot: z.number().min(0.3).max(10).default(1.2),
	})
	.strict();
type PunchIn = z.infer<typeof punchInInput>;

/** The face's horizontal place in the source (0–1) at source second `at`, from the scene's face track. */
function focusAt(document: ClipDocument, at: number): number {
	const track = (sceneOf(document)?.marks?.reframe?.track ?? []) as [number, number][];
	if (!track.length) return 0.5;
	if (at <= track[0]![0]) return track[0]![1];
	for (let index = 1; index < track.length; index++) {
		const [time, focus] = track[index]!;
		if (at <= time) {
			const [before, from] = track[index - 1]!;
			return from + ((focus - from) * (at - before)) / Math.max(1e-6, time - before);
		}
	}
	return track.at(-1)![1];
}

export const punchIn = {
	name: 'punch_in',
	input: punchInInput,
	describe: (input: PunchIn) => (input.scales[0] === 1 && input.scales[1] === 1 ? 'Remove the punch-in' : `Punch in ${input.scales.join('× / ')}× at every cut`),
	async apply(document: ClipDocument, input: PunchIn) {
		const next = clone(document);
		const cut = nodes(next).find((node) => node.kind === 'sequence' && (node as { marks?: Record<string, unknown> }).marks?.['text-cut']) as unknown as Entity | undefined;
		const pieces = ((cut?.children as Entity[] | undefined) ?? []).filter((child) => child.kind === 'video');
		if (pieces.length < 2) throw new OpFailure('The speaker has no cuts to punch in on yet. Cut pauses or filler words first.');
		let index = 0;
		pieces.forEach((piece, at) => {
			const sourceIn = Number(piece.sourceIn ?? 0);
			const sourceOut = Number(piece.sourceOut ?? sourceIn);
			const seconds = (sourceOut - sourceIn) / Number(piece.playbackRate ?? 1);
			if (at > 0 && seconds >= input.min_shot) index = 1 - index;
			const zoom = input.scales[index]!;
			delete piece.scaleX;
			delete piece.scaleY;
			if (zoom === 1) {
				delete piece.scale;
				delete piece.offsetX;
				return;
			}
			const width = Number(piece.width ?? 0);
			const offset = round((focusAt(next, (sourceIn + sourceOut) / 2) - 0.5) * width * (1 - zoom));
			piece.scale = zoom;
			if (offset) piece.offsetX = offset;
			else delete piece.offsetX;
		});
		return checked(next, 'The punch-in could not be applied');
	},
};
