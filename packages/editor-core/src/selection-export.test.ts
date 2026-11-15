import { describe, expect, it } from 'vitest';

import type { ClipDocument } from '@opencmo/clip-doc';

import { activeScene } from './ops';
import { isolateSelection } from './selection-export';

type Node = { id?: string; kind: string; hidden?: boolean; children?: Node[] };

const doc = (children: Node[]) =>
  ({ version: 1, stage: { children: [{ kind: 'scene', id: 's', width: 1080, height: 1920, active: true, children }] } }) as unknown as ClipDocument;
const flags = (document: ClipDocument) => {
  const out: Record<string, boolean> = {};
  const visit = (node: Node) => {
    for (const child of node.children ?? []) {
      if (child.id) out[child.id] = Boolean(child.hidden);
      visit(child);
    }
  };
  visit(activeScene(document) as unknown as Node);
  return out;
};

describe('isolateSelection', () => {
  const tree = () =>
    doc([
      { id: 'master', kind: 'video' },
      { id: 'row', kind: 'sequence', children: [{ id: 'b1', kind: 'video' }, { id: 'b2', kind: 'video' }] },
      { id: 'group', kind: 'group', children: [{ id: 'g1', kind: 'text' }, { id: 'g2', kind: 'rect' }] },
      { id: 'captions', kind: 'captions' },
    ]);

  it('hides everything outside the selection, keeping the way down to a selected child', () => {
    const out = isolateSelection(tree(), ['b2']);
    expect(flags(out)).toEqual({ master: true, row: false, b1: true, b2: false, group: true, g1: false, g2: false, captions: true });
  });

  it('keeps a selected group whole', () => {
    expect(flags(isolateSelection(tree(), ['group', 'master']))).toMatchObject({ master: false, group: false, g1: false, g2: false, row: true, captions: true });
  });

  it('leaves the original untouched', () => {
    const source = tree();
    isolateSelection(source, ['b1']);
    expect(Object.values(flags(source)).some(Boolean)).toBe(false);
  });

  it('refuses ids that are not on the timeline', () => {
    expect(() => isolateSelection(tree(), ['nope'])).toThrow('None of the selected clips');
  });
});
