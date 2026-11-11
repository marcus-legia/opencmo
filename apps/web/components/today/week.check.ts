/**
 * Writer's and Today's "This week" place a draft by its day, not its weekday label (2026-11-11: last week's Thursday
 * post read as this week's, so the week showed duplicates and more posts than were planned).
 *
 *     cd apps/web && npx tsx components/today/week.check.ts
 */
import assert from "node:assert/strict";

import type { WriterScreen } from "@/lib/screens/writer";

import { dayLabel, draftsLeftOver, draftsThisWeek, thisMonday } from "./week";

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

console.log("week.check: this week by day, last week apart ok");
