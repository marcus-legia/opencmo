/**
 * Picked moments: the rules every path shares, and the picker URL (contract A1 of
 * docs/plans/product/2026-10-19-clipping-repurpose-mcp-sessions.md).
 *
 * `createClipJob`, the full-size picker and the MCP `make_clips` tool read the same rules here, so a
 * moment the picker accepts is one the server accepts. `create_job()` checks them again in SQL, and
 * the worker a third time; SQL is the real gate.
 *
 * No `server-only`: the picker runs it in the browser and `segments.check.ts` runs it with tsx.
 */

/** Same number as `MAX_SEGMENT_SECONDS` in the worker and the rule in `create_job()`. */
export const MAX_SEGMENT_SECONDS = 180;
export const MIN_SEGMENT_SECONDS = 1;
export const MAX_SEGMENTS = 10;

export type Segment = { start: number; end: number };

/** The first rule a list of moments breaks, as a sentence for the user; null when they are fine. */
export function segmentProblem(segments: Segment[]): string | null {
  if (!segments.length) return "Pick at least one moment to clip.";
  if (segments.length > MAX_SEGMENTS) return `Pick up to ${MAX_SEGMENTS} moments.`;
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  let previousEnd = -1;
  for (const { start, end } of sorted) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return "A moment has an invalid time.";
    const length = end - start;
    if (length < MIN_SEGMENT_SECONDS) return "Each moment must be at least 1 second long.";
    if (length > MAX_SEGMENT_SECONDS) return "Each moment must be 3 minutes or shorter.";
    if (start < previousEnd) return "Your moments overlap. Move them apart and try again.";
    previousEnd = end;
  }
  return null;
}

/** Up to milliseconds: enough for a playhead, and a URL stays short. */
const seconds = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * `segments=<start>-<end>,…` in seconds. Anything that does not parse, or breaks a rule, gives an
 * empty list: the picker then opens empty instead of half filled.
 */
export function parseSegments(param: string | null | undefined): Segment[] {
  if (!param) return [];
  const out: Segment[] = [];
  for (const part of param.split(",")) {
    const match = /^\s*(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\s*$/.exec(part);
    if (!match) return [];
    out.push({ start: Number(match[1]), end: Number(match[2]) });
  }
  if (segmentProblem(out)) return [];
  return out.sort((a, b) => a.start - b.start);
}

export const formatSegments = (segments: Segment[]): string =>
  [...segments].sort((a, b) => a.start - b.start).map((s) => `${seconds(s.start)}-${seconds(s.end)}`).join(",");

/** The editor path that opens the full-size picker, pre-filled when a source and moments are given. */
export function pickerPath(input: { source?: string; segments?: Segment[] } = {}): string {
  const params = new URLSearchParams({ panel: "clips", picker: "open" });
  if (input.source) params.set("source", input.source);
  if (input.segments?.length) params.set("segments", formatSegments(input.segments));
  return `/app/editor?${params.toString()}`;
}
