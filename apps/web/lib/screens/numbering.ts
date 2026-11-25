/**
 * The index that ties Sales and Post together (owner, 2026-11-25: "it shows no thread between them; numbered like
 * Post"): the newest finished scan is Scan #1, each person it found is 1.k by score, and the newest post is Post #1
 * (owner: newest on top, as #1; numbers move down as new ones arrive). A post written from a Sales person names
 * "Scan #n · n.k", and that person names "Post #m". Scans are numbered by when they finished. Pure.
 */

export type ScanRow = { id: string; created_at: string };
export type PersonRow = { id: string; run_id: string | null; score: number; created_at: string };
export type PostRow = { id: string; created_at: string; sources?: unknown };

// A row without a time (a read that left the column out) sorts first rather than failing the screen.
const byTime = <T extends { id: string; created_at: string }>(a: T, b: T) =>
  String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id));

/**
 * Numbers from a newest-first page of rows: the newest is #1, the one before it #2 (owner, 2026-11-25: "the newest on
 * top, as #1"). A number moves down one when a newer row arrives.
 */
export function numbersFromNewest(rows: { id: string }[]): Map<string, number> {
  return new Map(rows.map((r, i) => [r.id, i + 1]));
}

/** "3.1", "3.2": a scan's people by score (best first). A person with no numbered scan has none. */
export function personNumbers(people: PersonRow[], scans: Map<string, number>): Map<string, string> {
  const groups = new Map<string, PersonRow[]>();
  for (const p of people) if (p.run_id && scans.has(p.run_id)) groups.set(p.run_id, [...(groups.get(p.run_id) ?? []), p]);
  const out = new Map<string, string>();
  for (const [run, list] of groups) {
    list.sort((a, b) => b.score - a.score || byTime(a, b)).forEach((p, i) => out.set(p.id, `${scans.get(run)}.${i + 1}`));
  }
  return out;
}

/** The opportunity ids a post was written from (`body.sources[].opportunityId`). */
export function sourceIds(sources: unknown): string[] {
  return Array.isArray(sources)
    ? sources.flatMap((s) => (s && typeof s === "object" && typeof (s as { opportunityId?: unknown }).opportunityId === "string" ? [(s as { opportunityId: string }).opportunityId] : []))
    : [];
}

/** For each Sales person, the posts written from them, newest first: "Used in Post #14". */
export function usedIn(posts: PostRow[], numbers: Map<string, number>): Map<string, { no: number; id: string }[]> {
  const out = new Map<string, { no: number; id: string }[]>();
  for (const p of posts) {
    const no = numbers.get(p.id);
    if (!no) continue;
    for (const opp of new Set(sourceIds(p.sources))) out.set(opp, [...(out.get(opp) ?? []), { no, id: p.id }]);
  }
  // Post #1 is the newest: number order is newest first.
  for (const list of out.values()) list.sort((a, b) => a.no - b.no);
  return out;
}
