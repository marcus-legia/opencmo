/**
 * Timing invariants the schema cannot express: a document can be shape-valid and still have a
 * clip that ends before it starts. `validate()` stays shape-only so old documents keep loading;
 * editor-core rejects edits that introduce one of these (`applyOps`).
 */

export type TimingIssueKind = 'start-after-end' | 'source-in-after-out' | 'negative-time' | 'bad-playback-rate';

export type TimingIssue = {
  /**
   * The node's id. A node without one yet is keyed by its kind and timing values instead of its
   * position: inserting a sibling or stamping ids must not make an old issue look new.
   */
  key: string;
  kind: TimingIssueKind;
  message: string;
};

type Node = Record<string, unknown>;

const seconds = (value: number): string => `${Number(value.toFixed(3))}s`;

function label(node: Node): string {
  const kind = typeof node.kind === 'string' ? node.kind : 'element';
  const name = typeof node.name === 'string' && node.name ? node.name : typeof node.id === 'string' ? node.id : null;
  const noun = kind.charAt(0).toUpperCase() + kind.slice(1);
  return name ? `${noun} "${name}"` : noun;
}

function check(node: Node, out: TimingIssue[]): void {
  const num = (field: string): number | undefined => (typeof node[field] === 'number' ? (node[field] as number) : undefined);
  const who = label(node);
  const [start, end, sourceIn, sourceOut, rate] = [num('start'), num('end'), num('sourceIn'), num('sourceOut'), num('playbackRate')];
  const key = typeof node.id === 'string' ? node.id : `${String(node.kind)}@${[start, end, sourceIn, sourceOut, rate].join(',')}`;
  for (const [field, value] of [['start', start], ['end', end], ['sourceIn', sourceIn], ['sourceOut', sourceOut]] as const) {
    if (value !== undefined && value < 0) {
      out.push({ key, kind: 'negative-time', message: `${who}: ${field} is ${seconds(value)}. Times cannot be negative.` });
    }
  }
  if (start !== undefined && end !== undefined && !(start < end)) {
    out.push({ key, kind: 'start-after-end', message: `${who}: start (${seconds(start)}) must be before end (${seconds(end)}).` });
  }
  if (sourceIn !== undefined && sourceOut !== undefined && !(sourceIn < sourceOut)) {
    out.push({
      key,
      kind: 'source-in-after-out',
      message: `${who}: sourceIn (${seconds(sourceIn)}) must be before sourceOut (${seconds(sourceOut)}).`,
    });
  }
  if (rate !== undefined && !(rate > 0)) {
    out.push({ key, kind: 'bad-playback-rate', message: `${who}: playbackRate is ${rate}. It must be greater than 0.` });
  }
}

/** Every timing issue in the document's nodes (children and masks, at any depth). */
export function timingIssues(document: unknown): TimingIssue[] {
  const out: TimingIssue[] = [];
  const visit = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const node = item as Node;
      check(node, out);
      visit(node.masks);
      visit(node.children);
    }
  };
  visit((document as { stage?: { children?: unknown } } | null)?.stage?.children);
  return out;
}
