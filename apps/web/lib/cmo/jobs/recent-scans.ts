/**
 * What the last scans searched and passed over (2026-11-25), read back from their outputs, newest first. Pure: the
 * Supabase store and the memory store share it.
 */

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function recentFrom(rows: { output: unknown; input?: unknown }[]): { queries: string[]; rejected: string[] } {
  // A search on a platform that failed, or steered by a past brief, did not cover the usual ground: the next scan may
  // use it again.
  const usual = rows.filter((r) => !strings(record(r.output).failed).length && !record(r.input).brief);
  return {
    queries: [...new Set(usual.flatMap((r) => strings(record(r.output).queries)))].slice(0, 40),
    rejected: rows.flatMap((r) => strings(record(r.output).rejected)),
  };
}
