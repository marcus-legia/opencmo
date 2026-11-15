/**
 * "Export selection: selected clips only" (plan 2026-11-15 A2, learned from CapCut Web's partial export): a copy of
 * the document where everything outside the selection is hidden. `hidden` drops both picture and sound in the
 * renderer and the exporter, so the file holds the selected clips and nothing else. The user's project is untouched:
 * this runs on the export copy only.
 */

import type { ClipDocument } from '@opencmo/clip-doc';

import { activeScene } from './ops';

type Node = Record<string, unknown> & { id?: string; children?: Node[]; hidden?: boolean };

/** The selection that can be isolated: at most this many ids (a selection, not a whole project). */
export const ISOLATE_MAX = 200;

export class IsolateError extends Error {}

/**
 * Hides every node of the active scene that is neither selected, inside a selected node, nor on the way down to one.
 * A selected group keeps all of its children; a group that only holds a selected child keeps that child and hides the
 * rest. Throws when none of the ids is in the active scene.
 */
export function isolateSelection(document: ClipDocument, ids: readonly string[]): ClipDocument {
  const wanted = new Set(ids);
  const next = structuredClone(document);
  const scene = activeScene(next) as unknown as Node;
  let found = 0;
  const holds = new Map<Node, boolean>();
  const contains = (node: Node): boolean => {
    const known = holds.get(node);
    if (known !== undefined) return known;
    const result = (node.id !== undefined && wanted.has(node.id)) || (node.children ?? []).some(contains);
    holds.set(node, result);
    return result;
  };
  const visit = (node: Node) => {
    for (const child of node.children ?? []) {
      if (child.id !== undefined && wanted.has(child.id)) {
        found++;
        continue;
      }
      if (contains(child)) visit(child);
      else child.hidden = true;
    }
  };
  visit(scene);
  if (!found) throw new IsolateError('None of the selected clips is on this timeline.');
  return next;
}
