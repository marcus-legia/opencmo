import { describe, expect, it } from 'vitest';

import type { ClipDocument } from '@opencmo/clip-doc';

import { activeScene, applyOps, type OpContext } from './ops';

const doc = (scene: Record<string, unknown> = {}) =>
  ({ version: 1, stage: { children: [{ kind: 'scene', id: 's', width: 1080, height: 1920, active: true, children: [], ...scene }] } }) as unknown as ClipDocument;
const ctx = {} as OpContext;
const cover = (document: ClipDocument) => (activeScene(document) as unknown as { cover?: number }).cover;

describe('set_cover', () => {
  it('stores the time on the frame grid, and clears it', async () => {
    const set = (await applyOps(doc(), [{ op: 'set_cover', time: 2.01 }], ctx)).document;
    expect(cover(set)).toBe(2);
    expect(cover((await applyOps(set, [{ op: 'set_cover', clear: true }], ctx)).document)).toBeUndefined();
  });

  it('refuses a cover outside the exported work area', async () => {
    await expect(applyOps(doc({ workarea: [1, 4] }), [{ op: 'set_cover', time: 5 }], ctx)).rejects.toThrow('inside the part that is exported');
  });

  it('needs a time or clear', async () => {
    await expect(applyOps(doc(), [{ op: 'set_cover' }], ctx)).rejects.toThrow();
  });
});

type Piece = { id?: string; kind: string; name?: string; start?: number; end?: number; sourceIn?: number; sourceOut?: number; playbackRate?: number; paints?: { type: string; src?: string }[]; children?: Piece[] };
const broll = (extra: Partial<Piece> = {}): Piece => ({
  id: 'b',
  kind: 'rect',
  start: 2,
  end: 8,
  sourceIn: 1,
  paints: [{ type: 'video', src: 'assets/broll.mp4' }],
  ...extra,
});
const children = (document: ClipDocument) => (activeScene(document) as unknown as { children: Piece[] }).children;

describe('speed_ramp', () => {
  it('cuts the clip into parts at the preset speeds, keeping its length and its footage', async () => {
    const out = (await applyOps(doc({ children: [broll()] }), [{ op: 'speed_ramp', element_id: 'b', preset: 'hero' }], ctx)).document;
    const [row] = children(out);
    expect(row!.kind).toBe('sequence');
    const parts = row!.children!;
    expect(parts.map((p) => p.playbackRate)).toEqual([1.5, 1.5, 0.25, 0.25, 1.25, 1.25]);
    expect(parts[0]!.start).toBe(2);
    expect(parts.at(-1)!.end).toBe(8);
    // Footage runs on without gaps from the clip's own sourceIn, and uses as much as before (6 s at 1×).
    for (let i = 1; i < parts.length; i++) expect(parts[i]!.sourceIn).toBeCloseTo(parts[i - 1]!.sourceOut!, 3);
    expect(parts[0]!.sourceIn).toBe(1);
    expect(parts.at(-1)!.sourceOut).toBeCloseTo(7, 3);
  });

  it('keeps the fade-in on the first part and the fade-out on the last', async () => {
    const animations = [{ type: 'fade', phase: 'in', duration: 0.5 }, { type: 'fade', phase: 'out', duration: 0.5 }];
    const out = (await applyOps(doc({ children: [broll({ animations } as never)] }), [{ op: 'speed_ramp', element_id: 'b', preset: 'montage' }], ctx)).document;
    const parts = children(out)[0]!.children! as (Piece & { animations?: { phase: string }[] })[];
    expect(parts.map((p) => (p.animations ?? []).map((a) => a.phase))).toEqual([['in'], [], [], [], [], ['out']]);
  });

  it("refuses the clip's own transcript-timed video", async () => {
    const master = { id: 'm', kind: 'video', src: 'assets/master.mp4', start: 0, end: 5 };
    await expect(applyOps(doc({ children: [master] }), [{ op: 'speed_ramp', element_id: 'm', preset: 'montage' }], ctx)).rejects.toThrow();
  });
});

describe('freeze_frame', () => {
  it('holds a still of the frame in the clip\'s place and pushes what follows later', async () => {
    const after = { id: 'after', kind: 'rect', start: 9, end: 10, fill: '#ff0000' };
    const out = (
      await applyOps(doc({ children: [broll(), after] }), [{ op: 'freeze_frame', element_id: 'b', at: 4, seconds: 2, src: 'Frames/freeze.jpg' }], ctx)
    ).document;
    const [row, moved] = children(out);
    const [first, still, rest] = row!.children!;
    expect(first!.end).toBe(4);
    expect(still!.name).toBe('Freeze frame');
    expect([still!.start, still!.end]).toEqual([4, 6]);
    expect(still!.paints).toMatchObject([{ type: 'image', src: 'Frames/freeze.jpg' }]);
    expect(still!.sourceIn).toBeUndefined();
    expect(rest!.start).toBe(6);
    expect(moved!.start).toBe(11);
  });

  it('needs the playhead inside the clip', async () => {
    await expect(applyOps(doc({ children: [broll()] }), [{ op: 'freeze_frame', element_id: 'b', at: 9, seconds: 2, src: 'Frames/f.jpg' }], ctx)).rejects.toThrow('inside the clip');
  });
});
