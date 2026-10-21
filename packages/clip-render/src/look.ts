/**
 * What the look tools tell the model about a frame: which seconds to draw, which layers are on
 * screen, and how to read the colour numbers. One copy for the in-app Assistant (browser) and
 * for Claude over MCP (`clip-export look`), so both see and say the same thing.
 */

import type { ClipDocument } from '@opencmo/clip-doc';

export const MAX_LOOK_TIMES = 12;

export type LookTimes = { times?: number[]; start?: number; end?: number; count?: number };

/** Seconds to draw: `times`, or `count` frames evenly spread over `[start, end)` (default: the whole export). */
export function captureTimes(input: LookTimes, length: number): number[] {
  if (input.times?.length) return input.times.slice(0, MAX_LOOK_TIMES);
  const start = Math.max(0, input.start ?? 0);
  const end = Math.min(length, input.end ?? length);
  const count = Math.max(1, Math.min(MAX_LOOK_TIMES, input.count ?? 6));
  if (end <= start) return [start];
  const step = (end - start) / count;
  return Array.from({ length: count }, (_, index) => Math.round((start + step * (index + 0.5)) * 100) / 100);
}

export type LookBox = { node: { id?: string; kind: string; text?: unknown; src?: unknown; name?: unknown }; visible: boolean; matrix: number[]; box: number[]; start: number; end: number };
export type VisibleLayer = { id: string; kind: string; label?: string; box: number[] };

/** Layers on screen at a frame, top first, with their 0-1 box of the frame, so the model names the id it sees. */
export function visibleAt(boxes: LookBox[], frame: number, scene: { width: number; height: number }): VisibleLayer[] {
  const out: VisibleLayer[] = [];
  for (const item of boxes) {
    const { node } = item;
    if (!item.visible || !node.id || frame < item.start || frame >= item.end) continue;
    if (['group', 'sequence', 'scene', 'audio'].includes(node.kind)) continue;
    const [bx, by, bw, bh] = item.box as [number, number, number, number];
    if (!(bw > 0 && bh > 0)) continue;
    const [a, b, c, d, e, f] = item.matrix as [number, number, number, number, number, number];
    const corners = [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]].map(([x, y]) => [a * x! + c * y! + e, b * x! + d * y! + f]);
    const xs = corners.map((p) => p[0]! / scene.width);
    const ys = corners.map((p) => p[1]! / scene.height);
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
    const rect = [clamp(Math.min(...xs)), clamp(Math.min(...ys)), clamp(Math.max(...xs)), clamp(Math.max(...ys))];
    if (rect[2]! <= rect[0]! || rect[3]! <= rect[1]!) continue;
    const raw = typeof node.text === 'string' ? node.text : typeof node.name === 'string' ? node.name : typeof node.src === 'string' ? node.src : '';
    out.push({ id: node.id, kind: node.kind, ...(raw ? { label: raw.trim().slice(0, 40) } : {}), box: rect });
  }
  // Layout lists in draw order (bottom first): reversed so the top layer comes first.
  return out.reverse().slice(0, 15);
}

/**
 * The document without captions and text: a frame fed to an image model would have its text
 * redrawn garbled, and white letters skew the colour numbers.
 */
export function withoutText(document: ClipDocument): ClipDocument {
  const strip = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    const record = node as { children?: unknown[]; stage?: unknown };
    if (record.stage) return { ...record, stage: strip(record.stage) };
    if (!Array.isArray(record.children)) return node;
    return {
      ...record,
      children: record.children
        .filter((child) => !(child && typeof child === 'object' && ['captions', 'text'].includes((child as { kind?: string }).kind ?? '')))
        .map(strip),
    };
  };
  return strip(document) as ClipDocument;
}

/** How to read `scopeStats` numbers: the thresholds of a normally exposed frame. */
export const COLOR_GUIDE =
  'black/median/white are luma 0-1 (healthy: black 0.02-0.06, white 0.9-0.98). clipped* = share of crushed or blown pixels (keep under 0.02 unless it is a stylistic choice). average = mean RGB: on a neutral scene a channel well above the others is a color cast. saturation 0-1 (natural footage ~0.1-0.3). histogram = 16 luma bins, dark to bright.';
