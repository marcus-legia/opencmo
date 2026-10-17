import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';
import { isEmphasized, type Transcript as RenderTranscript } from '@opencmo/clip-render';

import { nodes } from '../doc';
import { normalize, type Transcript } from '../transcript';
import { applyOps, type OpContext } from './index';

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
					{ kind: 'video', src: 'assets/master.mp4', width: 1080, height: 1920, start: 0, sourceIn: 2, sourceOut: 32 },
					{ kind: 'captions', src: 'assets/transcript.json', preset: 'spotlight', start: 0, sourceIn: 2, sourceOut: 32 },
				],
			},
		],
	},
} as unknown as ClipDocument;

const TRANSCRIPT: Transcript = [
	{ text: 'so um this one is free', words: 'so um this one is free'.split(' ').map((text, index) => ({ text, start: 2 + index * 0.5, end: 2.4 + index * 0.5 })) },
	{ text: 'it has 24 skills', words: 'it has 24 skills'.split(' ').map((text, index) => ({ text, start: 10 + index * 0.4, end: 10.3 + index * 0.4 })) },
];

function memory(): OpContext & { files: Map<string, Transcript> } {
	const files = new Map<string, Transcript>([['assets/transcript.json', TRANSCRIPT]]);
	return {
		files,
		master: { width: 1920, height: 1080 },
		readTranscript: async (path) => structuredClone(files.get(path)!),
		saveTranscript: async (transcript) => {
			const path = `assets/transcripts/${String(files.size).padStart(64, '0')}.json`;
			files.set(path, structuredClone(transcript));
			return path;
		},
	};
}

const captions = (document: ClipDocument) => nodes(document).find((node) => node.kind === 'captions') as unknown as Record<string, unknown> & { src: string; emphasis?: { start: number; end: number }[] };

/** The words the renderer would draw emphasized, from the file the captions layer reads. */
function emphasized(document: ClipDocument, ctx: { files: Map<string, Transcript> }): string[] {
	const layer = captions(document);
	const transcript = ctx.files.get(layer.src) as unknown as RenderTranscript;
	return transcript.flatMap((segment) => segment.words).filter((word) => isEmphasized(word, layer.emphasis ?? [])).map((word) => word.text);
}

describe('emphasize_words', () => {
	it('stores source-second ranges on the captions layer; the renderer finds exactly those words', async () => {
		const ctx = memory();
		const { document } = await applyOps(SOURCE, [{ op: 'emphasize_words', quotes: ['free', '24 skills'] }], ctx);
		expect(() => validate(document)).not.toThrow();
		expect(captions(document).emphasis).toEqual([{ start: 4.5, end: 4.5 }, { start: 10.8, end: 11.2 }]);
		expect(emphasized(document, ctx)).toEqual(['free', '24', 'skills']);
	});

	it('emphasis survives a cut: removing other words keeps it on the same words', async () => {
		const ctx = memory();
		const um = normalize(TRANSCRIPT)[0]!.words[1]!.id!;
		const has = normalize(TRANSCRIPT)[1]!.words[1]!.id!;
		const { document } = await applyOps(SOURCE, [{ op: 'emphasize_words', quotes: ['free', '24'] }, { op: 'remove_words', word_ids: [um, has] }], ctx);
		// The captions now read a remapped transcript in clip time; the words keep their source ids.
		expect(captions(document).src).toMatch(/^assets\/transcripts\//);
		expect(emphasized(document, ctx)).toEqual(['free', '24']);
		// Cutting an emphasized word removes it from the screen and nothing else gains emphasis.
		const free = normalize(TRANSCRIPT)[0]!.words[5]!.id!;
		const cut = await applyOps(document, [{ op: 'remove_words', word_ids: [free] }], ctx);
		expect(emphasized(cut.document, ctx)).toEqual(['24']);
	});

	it('adds to what is there, clear replaces, remove takes words out', async () => {
		const ctx = memory();
		const once = await applyOps(SOURCE, [{ op: 'emphasize_words', quotes: ['free'] }], ctx);
		const twice = await applyOps(once.document, [{ op: 'emphasize_words', quotes: ['24'] }], ctx);
		expect(emphasized(twice.document, ctx)).toEqual(['free', '24']);
		const cleared = await applyOps(twice.document, [{ op: 'emphasize_words', quotes: ['skills'], clear: true }], ctx);
		expect(emphasized(cleared.document, ctx)).toEqual(['skills']);
		const removed = await applyOps(twice.document, [{ op: 'emphasize_words', quotes: ['free'], remove: true }], ctx);
		expect(emphasized(removed.document, ctx)).toEqual(['24']);
		const none = await applyOps(twice.document, [{ op: 'emphasize_words', quotes: [], clear: true }], ctx);
		expect(captions(none.document).emphasis).toBeUndefined();
	});

	it('a quote not in the transcript fails with the quote error; nothing to do fails too', async () => {
		await expect(applyOps(SOURCE, [{ op: 'emphasize_words', quotes: ['compound interest'] }], memory())).rejects.toThrow(/not in this clip's transcript/);
		await expect(applyOps(SOURCE, [{ op: 'emphasize_words', quotes: [] }], memory())).rejects.toThrow(/quotes to emphasize/);
	});
});
