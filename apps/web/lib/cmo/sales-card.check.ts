/**
 * The Sales card's rule badge and old-thread line (owner test 2026-11-23):
 *
 *     cd apps/web && npx tsx lib/cmo/sales-card.check.ts
 */
import assert from "node:assert/strict";

import { oldDays, ruleHeadline, scanSections } from "./sales-card";

const help = { rule: { kind: "help_only" as const, text: "" }, platform: "reddit" as const, person: undefined, postedAt: null };
assert.equal(ruleHeadline(help), "Help only · don't promote · DM them later");
assert.equal(ruleHeadline({ ...help, platform: "hn" }), "Help only · don't promote", "Hacker News has no DMs");
assert.equal(
  ruleHeadline({ ...help, person: { reach: { dmAllowed: false } } as never }),
  "Help only · don't promote",
  "a community that forbids DMs never says DM them later",
);
assert.equal(ruleHeadline({ ...help, person: { reach: { dmAllowed: true, buyer: false } } as never }), "Help only · don't promote", "a seller is never DMed");
assert.equal(ruleHeadline({ ...help, postedAt: "2026-10-01T00:00:00Z" }, Date.parse("2026-11-24T00:00:00Z")), "Help only · don't promote", "nor an old thread");
assert.equal(ruleHeadline({ ...help, rule: { kind: "requires_disclosure", text: "" } }), "You may name it · say it's yours");
assert.equal(ruleHeadline({ ...help, rule: { kind: "mention_allowed", text: "" } }), "You may name your product once");
assert.equal(ruleHeadline({ ...help, rule: { kind: "skipped", text: "" } }), "Don't reply here");

const now = Date.parse("2026-11-24T12:00:00Z");
assert.equal(oldDays("2026-11-11T12:00:00Z", now), null, "13 days is not old");
assert.equal(oldDays("2026-10-28T12:00:00Z", now), 27);
assert.equal(oldDays(null, now), null);
assert.equal(oldDays("not a date", now), null);
// The index's sections (owner, 2026-11-25): Scan #1 (the newest) on top, people in number order, an empty scan between
// listed ones kept, an empty scan older than every listed one dropped, unnumbered people last.
const scans = [
  { no: 1, at: "2026-11-25T00:00:00Z", cards: 1, verdict: "found" as const },
  { no: 2, at: "2026-11-24T00:00:00Z", cards: 0, verdict: "none" as const },
  { no: 3, at: "2026-11-23T00:00:00Z", cards: 2, verdict: "found" as const },
  { no: 4, at: "2026-11-21T00:00:00Z", cards: 0, verdict: "none" as const },
];
const sections = scanSections(
  [{ id: "a", scanNo: 3, no: "3.2" }, { id: "b", scanNo: 3, no: "3.1" }, { id: "c", scanNo: 1, no: "1.1" }, { id: "d" }],
  scans,
);
assert.deepEqual(sections.map((s) => [s.key, s.threads.map((t) => t.id)]), [["scan-1", ["c"]], ["scan-2", []], ["scan-3", ["b", "a"]], ["earlier", ["d"]]]);
assert.deepEqual(scanSections([], scans), [], "no people: no sections (the empty-state copy shows)");
// Review 2026-11-25: open people first within a scan; a scan that found people not loaded here is left out.
const ordered = scanSections(
  [{ id: "x", scanNo: 3, no: "3.1", status: "replied" }, { id: "y", scanNo: 3, no: "3.2", status: "open" }, { id: "z", scanNo: 1, no: "1.1", status: "open" }],
  [scans[0]!, { no: 2, at: "2026-11-24T00:00:00Z", cards: 3, verdict: "found" as const }, scans[2]!, scans[3]!],
);
assert.deepEqual(ordered.map((s) => [s.key, s.threads.map((t) => t.id)]), [["scan-1", ["z"]], ["scan-3", ["y", "x"]]]);
console.log("sales-card: ok");
