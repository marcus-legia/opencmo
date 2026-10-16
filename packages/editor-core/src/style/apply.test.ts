import { describe, expect, it } from 'vitest';

import { validate, type ClipDocument } from '@opencmo/clip-doc';

import { CAPABILITIES, type CapabilityInfo } from '../capabilities';
import { nodes } from '../doc';
import { OpError, OpFailure, applyOps, type OpContext } from '../ops';
import { normalize, type Transcript } from '../transcript';
import { runStyle, type ApplyStyle, type CaptureState, type StyleContext, type StyleDeps } from './apply';
import type { EditPlanInput } from './plan';

const SOURCE: ClipDocument = {
	version: 1,
	stage: {
		background: '#000000',
		children: [
			{
				kind: 'scene',
				name: 'Clip',
				width: 1080,
				height: 1920,
				fill: '#000000',
				active: true,
				workarea: [0, 30],
				children: [
					{ kind: 'video', src: 'assets/master.mp4', width: 1080, height: 1920, objectFit: 'cover', start: 0, sourceIn: 2, sourceOut: 32 },
					{ kind: 'captions', src: 'assets/transcript.json', preset: 'classic', verticalAlign: 'bottom', start: 0, sourceIn: 2, sourceOut: 32 },
				],
			},
		],
	},
} as unknown as ClipDocument;

const TRANSCRIPT: Transcript = [
	{
		text: 'so this is um the thing',
		words: [
			{ text: 'so', start: 2.1, end: 2.3 },
			{ text: 'this', start: 2.35, end: 2.6 },
			{ text: 'is', start: 2.65, end: 2.8 },
			{ text: 'um', start: 3.0, end: 3.4 },
			{ text: 'the', start: 3.5, end: 3.7 },
			{ text: 'thing', start: 3.75, end: 4.2 },
		],
	},
	{ text: 'it has 24 skills for free', words: 'it has 24 skills for free'.split(' ').map((text, index) => ({ text, start: 10 + index * 0.4, end: 10.3 + index * 0.4 })) },
];

function memoryContext(captures: Record<string, CaptureState> = {}): StyleContext {
	const files = new Map<string, Transcript>([['assets/transcript.json', TRANSCRIPT]]);
	return {
		master: { width: 1920, height: 1080 },
		readTranscript: async (path) => {
			const found = files.get(path);
			if (!found) throw new Error(`missing ${path}`);
			return structuredClone(found);
		},
		saveTranscript: async (transcript) => {
			const path = `assets/transcripts/${String(files.size).padStart(64, '0')}.json`;
			files.set(path, structuredClone(transcript));
			return path;
		},
		capture: async (id) => captures[id] ?? null,
	};
}

/** The clip after a word cut ("um"): a cut sequence of two pieces, every element with an id. */
async function cutClip(ctx: OpContext): Promise<ClipDocument> {
	const um = normalize(TRANSCRIPT)[0]!.words[3]!.id!;
	return (await applyOps(SOURCE, [{ op: 'remove_words', word_ids: [um] }], ctx)).document;
}

const STYLE = {
	name: 'test-style',
	preset: {
		captions: { preset: 'spotlight', maxWords: 2, reveal: 'fade', emphasis: { fontStyle: 'italic', color: 'accent' } },
		hookTitle: { seconds: 3 },
		speaker: { punchIn: { scales: [1, 1.15], minShot: 1.2 } },
		chapters: { transition: 'dissolve' },
		palette: { accent: '#FF5500' },
	},
};

const ALL_READY = Object.fromEntries(Object.entries(CAPABILITIES).map(([id, info]) => [id, { ...info, ready: true }])) as Record<string, CapabilityInfo>;

const FAKE_VISUALS = new Set(['add_hook_title', 'add_list', 'add_proof']);

type Call = Record<string, unknown> & { op: string };

/**
 * The ops other tracks build, faked at their contract: visuals are groups with a `visual` mark,
 * emphasis and punch-in replace what was there. Everything else runs through the real registry.
 */
type FakeState = { emphasis: string[] };

function fakeDeps(calls: Call[] = [], capabilities: Record<string, CapabilityInfo> = ALL_READY, state: FakeState = { emphasis: [] }): StyleDeps {
	return {
		capabilities,
		has: () => true,
		style: (name) => (name === STYLE.name ? STYLE : null),
		async run(document, op, ctx) {
			calls.push(op);
			const next = structuredClone(document);
			const scene = next.stage.children[0] as unknown as { children: Record<string, unknown>[] };
			if (FAKE_VISUALS.has(op.op)) {
				if (op.op === 'add_proof' && op.focus === 'not on the page') throw new OpFailure('"not on the page" is not on the captured page.');
				scene.children.push({ kind: 'group', name: op.op, marks: { visual: { op: op.op, input: op } }, children: [] });
				return next;
			}
			// The captions keys Track B adds are not in the schema yet: the fake keeps them aside.
			if (op.op === 'emphasize_words') {
				state.emphasis = [...(op.clear ? [] : state.emphasis), ...(op.quotes as string[])];
				return document;
			}
			if (op.op === 'punch_in') {
				scene.children[0]!.name = `punched ${(op.scales as number[]).join('/')}`;
				return next;
			}
			if (op.op === 'set_props' && ['reveal', 'emphasisStyle'].some((key) => key in (op.props as object))) return document;
			try {
				return (await applyOps(document, [op], ctx)).document;
			} catch (error) {
				if (error instanceof OpError) throw new OpFailure(error.message);
				throw error;
			}
		},
	};
}

const request = (plan: Omit<EditPlanInput, 'style'>, style = STYLE.name): ApplyStyle =>
	({ op: 'apply_style', style, plan: { emphasis: [], chapters: [], proofs: [], ...plan, style } }) as ApplyStyle;

const groups = (document: ClipDocument, op: string) =>
	nodes(document).filter((node) => (node as { marks?: { visual?: { op?: string } } }).marks?.visual?.op === op);

describe('apply_style', () => {
	it('applies the preset and every beat of the plan, in the contract order', async () => {
		const ctx = memoryContext({ cap: { status: 'ready' } });
		const calls: Call[] = [];
		const { document, receipt } = await runStyle(
			await cutClip(ctx),
			request({
				hook: { lines: ['Three tools', 'that pay for themselves'] },
				emphasis: [{ quote: '24' }, { quote: 'free' }],
				chapters: [{ quote: 'the thing', title: 'The thing' }],
				list: { quote: 'it has', items: [{ label: 'One' }, { label: 'Two' }], reveal: [{ quote: '24' }, { quote: 'skills' }] },
				proofs: [{ capture_id: 'cap', quote: 'it has 24 skills', focus: '24 skills' }],
			}),
			ctx,
			fakeDeps(calls),
		);
		expect(calls.map((call) => call.op)).toEqual([
			'set_caption_style',
			'set_caption_breaks',
			'set_props',
			'set_props',
			'emphasize_words',
			'add_hook_title',
			'punch_in',
			'add_list',
			'set_props',
			'add_proof',
		]);
		expect(receipt.skipped).toEqual([]);
		expect(receipt.unavailable).toEqual([]);
		const captions = nodes(document).find((node) => node.kind === 'captions') as unknown as Record<string, unknown>;
		expect(captions).toMatchObject({ preset: 'spotlight', maxWords: 2 });
		const layer = captions.id;
		expect(calls.filter((call) => call.op === 'set_props').slice(0, 2)).toEqual([
			{ op: 'set_props', element_id: layer, props: { reveal: 'fade' } },
			{ op: 'set_props', element_id: layer, props: { emphasisStyle: { fontStyle: 'italic', color: '#FF5500' } } },
		]);
		expect(calls.find((call) => call.op === 'emphasize_words')).toEqual({ op: 'emphasize_words', quotes: ['24', 'free'], clear: true });
		expect(calls.find((call) => call.op === 'add_hook_title')).toMatchObject({ lines: ['Three tools', 'that pay for themselves'], start: 0, end: 3 });
		expect(calls.find((call) => call.op === 'add_list')).toMatchObject({ reveal_quotes: ['24', 'skills'] });
		// The chapter's transition sits on the left piece of the cut where "the thing" starts.
		const sequence = nodes(document).find((node) => node.kind === 'sequence') as unknown as { children: Record<string, unknown>[] };
		expect(sequence.children[0]!.transition).toEqual({ type: 'dissolve' });
		expect(sequence.children[1]!.transition).toBeUndefined();
		expect(receipt.applied).toContain('dissolve transition at 1 chapter');
	});

	it('skips a beat whose quote is not in the transcript and says why', async () => {
		const ctx = memoryContext();
		const { receipt } = await runStyle(await cutClip(ctx), request({ emphasis: [{ quote: '24' }, { quote: 'compound interest' }], chapters: [{ quote: 'chapter nobody said' }] }), ctx, fakeDeps());
		expect(receipt.skipped.map((item) => item.item)).toEqual(['Emphasis "compound interest"', 'Chapter "chapter nobody said"']);
		expect(receipt.skipped[0]!.reason).toMatch(/not in this clip's transcript/);
		expect(receipt.applied).toContain('Emphasis on 1 word: "24"');
	});

	it('reports a capability that is not ready as unavailable, and still applies the rest', async () => {
		const ctx = memoryContext({ cap: { status: 'ready' } });
		const calls: Call[] = [];
		const capabilities = { ...ALL_READY, 'title.hook': { ...ALL_READY['title.hook']!, ready: false }, 'proof.capture': { ...ALL_READY['proof.capture']!, ready: false } };
		const { receipt } = await runStyle(
			await cutClip(ctx),
			request({ hook: { lines: ['A hook'] }, proofs: [{ capture_id: 'cap', quote: 'it has 24 skills', focus: '24 skills' }] }),
			ctx,
			fakeDeps(calls, capabilities),
		);
		expect(receipt.unavailable).toEqual(['title.hook', 'proof.capture']);
		expect(calls.map((call) => call.op)).not.toContain('add_hook_title');
		expect(calls.map((call) => call.op)).not.toContain('add_proof');
		expect(calls.map((call) => call.op)).toContain('punch_in');
	});

	it('takes proofs only from finished captures; a refused proof is skipped, not fatal', async () => {
		const ctx = memoryContext({ ready: { status: 'ready' }, pending: { status: 'pending' }, failed: { status: 'failed', error: 'That page could not be opened.' } });
		const quote = 'it has 24 skills';
		const { receipt, document } = await runStyle(
			await cutClip(ctx),
			request({
				proofs: [
					{ capture_id: 'pending', quote, focus: 'a' },
					{ capture_id: 'failed', quote, focus: 'b' },
					{ capture_id: 'gone', quote, focus: 'c' },
					{ capture_id: 'ready', quote, focus: 'not on the page' },
					{ capture_id: 'ready', quote, focus: '24 skills' },
				],
			}),
			ctx,
			fakeDeps(),
		);
		expect(receipt.skipped.map((item) => item.reason)).toEqual([
			'The page capture is not finished yet.',
			'The page capture failed: That page could not be opened.',
			'That capture was not found.',
			'"not on the page" is not on the captured page.',
		]);
		expect(groups(document, 'add_proof')).toHaveLength(1);
	});

	it('a second run replaces the first: one hook, one list, one set of proofs, emphasis cleared first', async () => {
		const ctx = memoryContext({ cap: { status: 'ready' } });
		const plan = request({
			hook: { lines: ['A hook'] },
			emphasis: [{ quote: '24' }],
			list: { quote: 'it has', items: [{ label: 'One' }, { label: 'Two' }] },
			proofs: [{ capture_id: 'cap', quote: 'it has 24 skills', focus: '24 skills' }],
		});
		const state = { emphasis: [] };
		const once = await runStyle(await cutClip(ctx), plan, ctx, fakeDeps([], ALL_READY, state));
		const twice = await runStyle(once.document, plan, ctx, fakeDeps([], ALL_READY, state));
		for (const op of ['add_hook_title', 'add_list', 'add_proof']) expect(groups(twice.document, op)).toHaveLength(1);
		expect(twice.receipt.applied.slice(0, 3)).toEqual(['Replaced 1 earlier hook title', 'Replaced 1 earlier list', 'Replaced 1 earlier proof card']);
		expect(twice.receipt.skipped).toEqual([]);
		expect(state.emphasis).toEqual(['24']);
		// A plan without emphasis still clears the emphasis an earlier run wrote.
		const emphasized = structuredClone(twice.document);
		(nodes(emphasized).find((node) => node.kind === 'captions') as unknown as Record<string, unknown>).emphasis = [{ start: 10.8, end: 11.1 }];
		const third: Call[] = [];
		await runStyle(emphasized, request({}), ctx, fakeDeps(third));
		expect(third.find((call) => call.op === 'emphasize_words')).toEqual({ op: 'emphasize_words', quotes: [], clear: true });
	});

	it('a wrong style or a plan for another style fails the whole op', async () => {
		const ctx = memoryContext();
		const clip = await cutClip(ctx);
		await expect(runStyle(clip, request({}, 'no-such-style'), ctx, fakeDeps())).rejects.toThrow(/no style named "no-such-style"/);
		const mismatched = { ...request({}), plan: { ...request({}).plan, style: 'other' } } as ApplyStyle;
		await expect(runStyle(clip, mismatched, ctx, fakeDeps())).rejects.toThrow(/plan is for "other"/);
	});
});

describe('apply_style through the registry', () => {
	const plan = {
		style: 'senior-dev-listicle',
		hook: { lines: ['Three tools', 'that pay for themselves'] },
		emphasis: [{ quote: '24' }, { quote: 'nowhere in the clip' }],
		chapters: [{ quote: 'the thing' }],
		proofs: [{ capture_id: 'cap', quote: 'it has 24 skills', focus: '24 skills' }],
	};

	it('is one op, one revision: the document before it is untouched, byte for byte', async () => {
		const ctx = memoryContext();
		const before = await cutClip(ctx);
		const snapshot = JSON.stringify(before);
		const { document, results } = await applyOps(before, [{ op: 'apply_style', style: 'senior-dev-listicle', plan }], ctx);
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ op: 'apply_style', changed: true });
		expect(JSON.stringify(before)).toBe(snapshot);
		expect(() => validate(document)).not.toThrow();
		// Undo restores the revision before the op: the same bytes it was given.
		expect(JSON.parse(snapshot)).toEqual(before);
	});

	it('degrades to what works today and reports the rest', async () => {
		const ctx = memoryContext({ cap: { status: 'ready' } });
		const deps: StyleDeps = {
			has: (name) => ['set_caption_style', 'set_caption_breaks', 'set_props', 'set_layout'].includes(name),
			run: async (document, op) => (await applyOps(document, [op], ctx)).document,
		};
		const { document, receipt } = await runStyle(await cutClip(ctx), { op: 'apply_style', style: 'senior-dev-listicle', plan } as ApplyStyle, ctx, deps);
		const captions = nodes(document).find((node) => node.kind === 'captions') as unknown as Record<string, unknown>;
		expect(captions).toMatchObject({ preset: 'spotlight', maxWords: 2 });
		expect(receipt.unavailable).toEqual(['caption.reveal', 'caption.emphasis', 'title.hook', 'speaker.punchIn', 'transition.whip', 'proof.capture', 'proof.card']);
		expect(receipt.applied).toEqual(['Captions: spotlight style', 'Captions show at most 2 words at a time']);
	});

	it('stays inside its budget (< 300 ms on the document, no worker)', async () => {
		const ctx = memoryContext();
		const before = await cutClip(ctx);
		await applyOps(before, [{ op: 'apply_style', style: 'senior-dev-listicle', plan }], ctx);
		const started = performance.now();
		await applyOps(before, [{ op: 'apply_style', style: 'senior-dev-listicle', plan }], ctx);
		expect(performance.now() - started).toBeLessThan(300);
	});
});
