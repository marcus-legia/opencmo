import { describe, expect, it } from 'vitest';

import type { ClipDocument } from '@opencmo/clip-doc';

import { applyOps, OpError, type OpContext } from './ops';

const ctx: OpContext = {
  master: null,
  readTranscript: async () => {
    throw new Error('not used');
  },
  saveTranscript: async () => 'x',
};

const doc = (children: unknown[]): ClipDocument =>
  ({ version: 1, stage: { children: [{ kind: 'scene', id: 'sc', width: 1080, height: 1920, children }] } }) as unknown as ClipDocument;
const kids = (document: ClipDocument) => (document.stage.children[0] as unknown as { children: Record<string, unknown>[] }).children;
const run = async (document: ClipDocument, ops: unknown[]) => (await applyOps(document, ops, ctx)).document;
const setProps = (element_id: string, props: Record<string, unknown>) => ({ op: 'set_props', element_id, props });

const video = { kind: 'video', id: 'v', src: 'assets/broll.mp4', start: 1, end: 4, sourceIn: 2, sourceOut: 5 };

describe('applyOps rejects batches that break timing', () => {
  it('start after end', async () => {
    await expect(run(doc([video]), [setProps('v', { start: 5 })])).rejects.toThrow('Video "v": start (5s) must be before end (4s).');
  });

  it('sourceIn after sourceOut', async () => {
    await expect(run(doc([video]), [setProps('v', { sourceIn: 6 })])).rejects.toThrow(/sourceIn \(6s\) must be before sourceOut \(5s\)/);
  });

  it('negative times', async () => {
    await expect(run(doc([video]), [setProps('v', { sourceIn: -1 })])).rejects.toThrow(/Times cannot be negative/);
  });

  it('playbackRate not above 0', async () => {
    await expect(run(doc([video]), [setProps('v', { playbackRate: 0 })])).rejects.toThrow(/playbackRate is 0/);
  });

  it('names the op that introduced the issue', async () => {
    const error = await run(doc([video, { kind: 'rect', id: 'r' }]), [setProps('r', { opacity: 0.5 }), setProps('v', { end: 0.5 })]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OpError);
    expect((error as OpError).index).toBe(1);
    expect((error as OpError).op).toBe('set_props');
  });

  it('judges the whole batch: a temporary issue fixed by a later op passes', async () => {
    const out = await run(doc([video]), [setProps('v', { start: 6 }), setProps('v', { end: 8 })]);
    expect(kids(out)[0]).toMatchObject({ start: 6, end: 8 });
  });

  it('an issue the document already had does not block an unrelated edit', async () => {
    const broken = { ...video, start: 9 };
    const out = await run(doc([broken, { kind: 'rect', id: 'r' }]), [setProps('r', { opacity: 0.5 })]);
    expect(kids(out)[1]).toMatchObject({ opacity: 0.5 });
  });

  it('nor an edit to the broken element that leaves the same issue', async () => {
    const out = await run(doc([{ ...video, start: 9 }]), [setProps('v', { opacity: 0.5 })]);
    expect(kids(out)[0]).toMatchObject({ start: 9, opacity: 0.5 });
  });

  it('old issues on elements without ids survive the id stamp', async () => {
    const legacy = { kind: 'video', src: 'assets/broll.mp4', start: 3, end: 1 };
    const out = await run(doc([legacy, { kind: 'rect', id: 'r' }]), [setProps('r', { opacity: 0.5 })]);
    expect(kids(out)[0]).toMatchObject({ start: 3, end: 1 });
    expect(typeof kids(out)[0]!.id).toBe('string');
  });
});
