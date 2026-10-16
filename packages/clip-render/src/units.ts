/**
 * Pure helpers of the per-unit text animator (`unit` / `order` / `step` on an animation): split text
 * into user-perceived characters, decide which unit starts when, and how far along each one is.
 * Shared by the renderer, its tests and the editor, so preview, export and the inspector agree.
 */

import type { ANIMATION_ORDERS } from '@opencmo/clip-doc';

export type UnitOrder = (typeof ANIMATION_ORDERS)[number];

type Segmenter = { segment(text: string): Iterable<{ segment: string }> };
let segmenter: Segmenter | null | undefined;

/**
 * User-perceived characters (grapheme clusters): "👋🏽" and a decomposed "ễ" (e + two combining marks)
 * stay whole, where `text.slice` by UTF-16 code unit would cut them. Never normalizes: NFC would
 * change what the user typed. Falls back to code points where `Intl.Segmenter` is missing.
 */
export function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    const Ctor = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: 'grapheme' }) => Segmenter }).Segmenter;
    segmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null;
  }
  if (!segmenter) return Array.from(text);
  const out: string[] = [];
  for (const part of segmenter.segment(text)) out.push(part.segment);
  return out;
}

/** 32-bit FNV-1a of a string: a stable seed from a node id, the same in the browser and in Node. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) h = Math.imul(h ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return h;
}

/**
 * Start rank of each of `n` units (index → rank; a unit starts `rank × step` after the first).
 * - first: left to right; last: right to left.
 * - center: the middle unit(s) first, both sides moving out together. `floor` so the two middle
 *   units of an even count share rank 0 (with `round` nothing would start at 0).
 * - random: a seeded Fisher–Yates shuffle, so scrubbing and export draw the same frame.
 */
export function unitRanks(n: number, order: UnitOrder, seed: number): number[] {
  const count = Math.max(0, Math.floor(n));
  const ranks = Array.from({ length: count }, (_, index) => index);
  if (order === 'last') return ranks.map((index) => count - 1 - index);
  if (order === 'center') return ranks.map((index) => Math.floor(Math.abs(index - (count - 1) / 2)));
  if (order !== 'random') return ranks;
  // mulberry32: small, fast and identical on every engine.
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = [...ranks];
  for (let index = count - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!];
  }
  // shuffled[k] is the unit that starts k-th; invert to unit → rank.
  const out = new Array<number>(count);
  shuffled.forEach((unit, rank) => (out[unit] = rank));
  return out;
}

/** Linear progress 0..1 of the unit with `rank` at time `t` (same unit as `step` and `unitLength`). Not eased. */
export function unitProgress(t: number, rank: number, step: number, unitLength: number): number {
  if (!(unitLength > 0)) return t >= rank * step ? 1 : 0;
  return Math.max(0, Math.min(1, (t - rank * step) / unitLength));
}
