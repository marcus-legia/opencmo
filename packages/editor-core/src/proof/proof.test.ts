import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { CAPABILITIES } from '../capabilities';
import { nodes, type Entity } from '../doc';
import { panelRegionAt } from '../layout';
import { applyOps, OP_NAMES } from '../ops';
import type { Transcript } from '../transcript';
import { closestText, findFocus, type CaptureRun, type ProofCapture, type ProofContext } from './index';

const SOURCE = {
	version: 1,
	stage: {
		children: [
			{
				kind: 'scene',
				width: 1080,
				height: 1920,
				active: true,
				workarea: [0, 30],
				children: [
					{ kind: 'video', src: 'assets/master.mp4', width: 1080, height: 1920, start: 0, sourceIn: 0, sourceOut: 30 },
					{ kind: 'captions', src: 'assets/transcript.json', preset: 'spotlight', start: 0, sourceIn: 0, sourceOut: 30 },
				],
			},
		],
	},
} as unknown as ClipDocument;

const say = (text: string, start: number) => ({ text, words: text.split(' ').map((word, index) => ({ text: word, start: start + index * 0.4, end: start + index * 0.4 + 0.3 })) });
const TRANSCRIPT: Transcript = [say('this repo is great', 2), say('it ships 24 lifecycle skills', 10), say('and twelve hundred teams use it', 20)];

/** A page as `page.boxes.json` stores it: one run per word, CSS pixels. */
function page(lines: string[], top = 100): CaptureRun[] {
	return lines.flatMap((line, row) => {
		let x = 40;
		return line.split(' ').map((text) => {
			const run: CaptureRun = { text, rect: [x, top + row * 40, text.length * 9, 22] };
			x += text.length * 9 + 6;
			return run;
		});
	});
}

const CAPTURE = '6f1c2a52-58a2-4b4e-9d8b-1a2b3c4d5e6f';
const README = page(['owner/repo', 'Ships with 24 lifecycle skills, for every agent.', 'Installed by 1,200 teams.'], 1800);

function context(captures: Record<string, ProofCapture | null> = {}): ProofContext {
	const ready: ProofCapture = { status: 'ready', url: 'https://github.com/owner/repo', width: 1280, height: 5000, runs: README };
	return {
		master: { width: 1080, height: 1920 },
		readTranscript: async () => structuredClone(TRANSCRIPT),
		saveTranscript: async () => 'assets/transcripts/x.json',
		proofCapture: async (id) => (id in captures ? captures[id]! : id === CAPTURE ? ready : null),
	};
}

const proofs = (document: ClipDocument) => nodes(document).filter((node) => ((node as unknown as Entity).marks as { visual?: { op?: string } } | undefined)?.visual?.op === 'add_proof') as unknown as Entity[];
const child = (group: Entity, name: string): Entity => {
	for (const node of group.children as Entity[]) {
		if (node.name === name) return node;
		if (Array.isArray(node.children)) {
			const found = (node.children as Entity[]).find((inner) => inner.name === name);
			if (found) return found;
		}
	}
	throw new Error(`no ${name}`);
};
const last = (node: Entity, property: string) => ((node.tracks as { property: string; keyframes: { time: number; value: number }[] }[]).find((track) => track.property === property)!.keyframes.at(-1)!);

const proof = (input: Record<string, unknown> = {}) => ({ op: 'add_proof', capture_id: CAPTURE, focus: '24 lifecycle skills', quote: 'it ships 24 lifecycle skills', ...input });

describe('finding the focus on a captured page', () => {
	it('matches across runs, forgiving case, spacing and punctuation at word edges', () => {
		const hit = findFocus(README, '24  LIFECYCLE skills');
		expect(hit).not.toBeNull();
		expect(README.slice(hit!.from, hit!.to).map((run) => run.text)).toEqual(['24', 'lifecycle', 'skills,']);
		expect(hit!.rect.y).toBe(1840);
		expect(findFocus(README, '1,200 teams')?.rect.y).toBe(1880);
	});

	it('does not invent words, and names the closest text', () => {
		expect(findFocus(README, '25 lifecycle skills')).toBeNull();
		expect(closestText(README, '25 lifecycle skills')).toBe('24 lifecycle skills,');
	});

	it('marks only the first line of a phrase that wraps', () => {
		const wrapped = page(['the best', 'tool around'], 0);
		const hit = findFocus(wrapped, 'best tool');
		expect(hit!.rect).toEqual({ x: wrapped[1]!.rect[0], y: 0, width: wrapped[1]!.rect[2], height: 22 });
	});
});

describe('add_proof', () => {
	it('is registered and its capabilities are ready', () => {
		expect(OP_NAMES).toContain('add_proof');
		expect(CAPABILITIES['proof.card'].ready).toBe(true);
		expect(CAPABILITIES['proof.capture'].ready).toBe(true);
	});

	it('places a browser card with the real address that zooms to the focus and marks it at the quote', async () => {
		const { document } = await applyOps(SOURCE, [proof()], context());
		expect(() => validate(document)).not.toThrow();
		const [card] = proofs(document);
		expect(card).toBeDefined();
		// Up 1.4 s before the line (10 s) so the zoom lands as it starts.
		expect(card!.start).toBeCloseTo(8.6);
		expect(child(card!, 'Address').text).toBe('github.com/owner/repo');
		const image = child(card!, 'Page image');
		expect((image.paints as { src: string }[])[0]!.src).toBe(`capture:${CAPTURE}`);

		// After the zoom the focus is larger and fully in view, vertically centred; near the page's left
		// edge it is not centred horizontally, since the page never leaves blank space in the frame.
		const pageGroup = (card!.children as Entity[]).find((node) => node.name === 'Page')!;
		const view = (pageGroup.masks as { x: number; y: number; width: number; height: number }[])[0]!;
		const scale = last(image, 'width').value / 1280;
		expect(scale).toBeGreaterThan((image.width as number) / 1280);
		const focus = findFocus(README, '24 lifecycle skills')!.rect;
		const cx = last(image, 'x').value + (focus.x + focus.width / 2) * scale;
		const cy = last(image, 'y').value + (focus.y + focus.height / 2) * scale;
		const left = last(image, 'x').value + focus.x * scale;
		expect(last(image, 'x').value).toBeCloseTo(view.x, 1);
		expect(left).toBeGreaterThan(view.x);
		expect(left + focus.width * scale).toBeLessThan(view.x + view.width);
		expect(cy).toBeCloseTo(view.y + view.height / 2, 0);

		// The marker grows across the focus when the line starts (card second 1.4).
		const marker = child(card!, 'Marker');
		const grow = (marker.tracks as { keyframes: { time: number; value: number }[] }[])[0]!.keyframes;
		expect(grow[1]!).toMatchObject({ time: 1.4, value: 0 });
		expect(grow[2]!.value).toBeGreaterThan(focus.width * scale);
		expect(marker.x as number).toBeLessThan(cx);
	});

	it('goes in the visual panel of a split layout', async () => {
		const { document } = await applyOps(SOURCE, [{ op: 'set_layout', mode: 'split-top', start: 0, end: 30 }, proof()], context());
		const panel = panelRegionAt(document, 9)!;
		const card = child(proofs(document)[0]!, 'Card');
		expect(card.y as number).toBeGreaterThanOrEqual(panel.y * 1920 - 1);
		expect((card.y as number) + (card.height as number)).toBeLessThanOrEqual((panel.y + panel.height) * 1920 + 1);
	});

	it('ends before the next proof card', async () => {
		const later = proof({ focus: '1,200 teams', quote: 'and twelve hundred teams use it' });
		const { document } = await applyOps(SOURCE, [later, proof()], context());
		const [second, first] = proofs(document);
		expect(first!.end as number).toBeLessThanOrEqual((second!.start as number) - 0.04);
	});

	it('refuses a focus that is not on the page, naming the closest text', async () => {
		await expect(applyOps(SOURCE, [proof({ focus: '25 lifecycle skills' })], context())).rejects.toThrow(
			'"25 lifecycle skills" is not on the captured page. The closest text on it is "24 lifecycle skills,".',
		);
	});

	it('refuses captures that are not ready, missing, or unreadable here', async () => {
		const pending = '00000000-0000-4000-8000-000000000001';
		const failed = '00000000-0000-4000-8000-000000000002';
		const ctx = context({
			[pending]: { status: 'pending', url: '', width: 1280, height: 1, runs: [] },
			[failed]: { status: 'failed', error: 'That page could not be opened.', url: '', width: 1280, height: 1, runs: [] },
		});
		await expect(applyOps(SOURCE, [proof({ capture_id: pending })], ctx)).rejects.toThrow('not finished yet');
		await expect(applyOps(SOURCE, [proof({ capture_id: failed })], ctx)).rejects.toThrow('That page capture failed: That page could not be opened.');
		await expect(applyOps(SOURCE, [proof({ capture_id: '00000000-0000-4000-8000-000000000003' })], ctx)).rejects.toThrow('There is no page capture with that id.');
		const { proofCapture: _, ...plain } = context();
		await expect(applyOps(SOURCE, [proof()], plain)).rejects.toThrow('Page captures cannot be read here.');
	});

	it('needs the quote in the transcript', async () => {
		await expect(applyOps(SOURCE, [proof({ quote: 'words nobody said' })], context())).rejects.toThrow("is not in this clip's transcript");
	});
});
