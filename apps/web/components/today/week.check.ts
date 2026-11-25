/**
 * Writer's and Today's "This week" place a draft by its day, not its weekday label (2026-11-11: last week's Thursday
 * post read as this week's, so the week showed duplicates and more posts than were planned).
 *
 *     cd apps/web && npx tsx components/today/week.check.ts
 */
import assert from "node:assert/strict";

import type { WriterScreen } from "@/lib/screens/writer";

import { dayLabel, draftsLeftOver, draftsThisWeek, postSections, thisMonday } from "./week";

type Draft = WriterScreen["drafts"][number];

const iso = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const monday = thisMonday();
const DAY = 86_400_000;
const draft = (id: string, day: string, column: Draft["column"]): Draft => ({
  id, kind: "post", platform: "x", at: null, dayText: "Thu", day, title: id, column, versions: 1, note: null, approvalId: null,
});

const drafts = [
  draft("this-thu", iso(monday + 3 * DAY + 3 * 3600_000), "planned"),
  draft("last-thu-planned", iso(monday - 4 * DAY + 3 * 3600_000), "planned"),
  draft("last-thu-waiting", iso(monday - 4 * DAY + 3 * 3600_000), "waiting"),
  draft("last-thu-posted", iso(monday - 4 * DAY + 3 * 3600_000), "posted"),
  draft("next-mon", iso(monday + 7 * DAY + 3 * 3600_000), "planned"),
  { ...draft("no-day", "2000-01-01", "planned"), day: undefined },
];

assert.deepEqual(draftsThisWeek(drafts).map((d) => d.id), ["this-thu", "no-day"], "only this week's days (and a draft without one)");
assert.deepEqual(draftsLeftOver(drafts).map((d) => d.id).sort(), ["last-thu-planned", "last-thu-waiting"], "last week's undecided drafts, apart");
assert.equal(dayLabel(drafts[0]!), "Thu", "this week's day reads as its weekday");
assert.match(dayLabel(drafts[1]!) ?? "", /^Thu \d{1,2} [A-Z][a-z]{2}$/, "last week's carries its date");

// Writer's index (2026-11-25): new drafts newest first, approved in the order they go out, posted newest first.
{
  const base = { kind: "post", platform: "x", dayText: null, title: "t", versions: 1, note: null, approvalId: null } as const;
  const d = (id: string, column: Draft["column"], no: number, at: string | null, day: string | null = null) => ({ ...base, id, column, no, at, day }) as Draft;
  const sections = postSections([
    d("w1", "waiting", 5, null, "2026-11-26"), d("w2", "waiting", 3, null, "2026-11-25"),
    d("s1", "scheduled", 2, "2026-11-28T09:00:00Z"), d("s2", "scheduled", 1, "2026-11-27T09:00:00Z"),
    d("p1", "posted", 0, "2026-11-20T09:00:00Z"), d("p2", "posted", 0, "2026-11-21T09:00:00Z"),
    d("l1", "planned", 7, null, "2026-11-29"), d("l2", "drafting", 6, null, "2026-11-28"),
  ]);
  assert.deepEqual(sections.new.map((x) => x.id), ["w2", "w1"], "the newest draft (#1 is the newest) first");
  assert.deepEqual(sections.approved.map((x) => x.id), ["s2", "s1"], "approved in the order they go out");
  assert.deepEqual(sections.posted.map((x) => x.id), ["p2", "p1"]);
  assert.deepEqual(sections.planned.map((x) => x.id), ["l2", "l1"]);
}
console.log("week.check: this week by day, last week apart ok");
