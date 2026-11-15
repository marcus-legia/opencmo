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
