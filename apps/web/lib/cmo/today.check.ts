/**
 * `buildToday` (CMO review 3, 1.1): ranking, the cap of 5, the silence thresholds, the founder's midnight, and the
 * connection row only when the loader found one.
 *
 *     cd apps/web && npx tsx lib/cmo/today.check.ts
 */
import assert from "node:assert/strict";

import { TodaySchema } from "../screens/dashboard";

import { buildToday, daysBetween, todayCountLine, todayPlatform, type TodayCard, type TodayInput } from "./today";

const failures: string[] = [];
function check(name: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const NOW = new Date("2026-11-10T09:00:00Z");
const card = (id: string, kind: string, raisedAt: string, extra: Partial<TodayCard> = {}): TodayCard => ({
  id, kind, department: kind === "reply" ? "sales" : "writer", title: `Card ${id}`, platform: null, raisedAt, expiresAt: null, ...extra,
});
const input = (extra: Partial<TodayInput> = {}): TodayInput => ({
  now: NOW,
  timezone: "UTC",
  cards: [],
  decidedToday: 0,
  failedSlots: [],
  lastPosted: [],
  needsAccount: [],
  firstRun: { readStrategy: false, rateDrafts: false },
  ...extra,
});

check("an empty day has no rows and no count line", () => {
  const today = buildToday(input());
  assert.deepEqual(today, { rows: [], done: 0, total: 0, more: 0 });
  assert.equal(todayCountLine(today), null);
});

check("the ranking follows the plan's order", () => {
  const today = buildToday(
    input({
      cards: [
        card("old-post", "post", "2026-11-01T08:00:00Z", { platform: "x" }),
        card("expiring", "schedule", "2026-11-09T08:00:00Z", { expiresAt: "2026-11-10T20:00:00Z" }),
        card("retry", "schedule", "2026-11-10T07:00:00Z"),
        card("reply", "reply", "2026-11-05T08:00:00Z"),
      ],
      failedSlots: [{ id: "slot-1", platform: "threads", title: "Card retry", at: "2026-11-10T08:00:00Z", approvalId: "retry" }],
      lastPosted: [
        { platform: "linkedin", at: "2026-11-01T10:00:00Z" }, // 9 days: critical
        { platform: "x", at: "2026-11-07T10:00:00Z" }, // 3 days: high
      ],
      firstRun: { readStrategy: true, rateDrafts: false },
    }),
  );
  assert.deepEqual(
    today.rows.map((row) => row.id),
    ["failed:slot-1", "silent:linkedin", "card:expiring", "first_run:strategy", "silent:x"],
  );
  assert.equal(today.rows[1]!.level, "critical");
  assert.equal(today.rows[1]!.title, "LinkedIn: nothing posted for 9 days");
  assert.equal(today.rows[1]!.action.type, "chat", "no LinkedIn post waits: ask the CMO for one");
  // X has a waiting post: the silence row opens it, and the card is not listed twice.
  assert.deepEqual(today.rows[4]!.action, { type: "card", approvalId: "old-post", label: "Open the post" });
  assert.equal(today.more, 1, "the reply is cut");
  assert.equal(today.total, 6);
});

check("at most five rows, the rest counted", () => {
  const cards = Array.from({ length: 9 }, (_, i) => card(`p${i}`, "post", `2026-11-0${i + 1}T08:00:00Z`));
  const today = buildToday(input({ cards, decidedToday: 2 }));
  assert.equal(today.rows.length, 5);
  assert.equal(today.more, 4);
  assert.equal(today.total, 11);
  assert.equal(todayCountLine(today), "2 of 11 done today");
  assert.ok(TodaySchema.safeParse(today).success, "fits the contract");
});

check("one card per kind before a second of any kind", () => {
  const today = buildToday(
    input({
      cards: [
        card("p1", "post", "2026-11-01T08:00:00Z"),
        card("p2", "post", "2026-11-02T08:00:00Z"),
        card("p3", "post", "2026-11-03T08:00:00Z"),
        card("r1", "reply", "2026-11-04T08:00:00Z"),
        card("g1", "goal", "2026-11-05T08:00:00Z"),
      ],
    }),
  );
  assert.deepEqual(today.rows.map((row) => row.id), ["card:p1", "card:r1", "card:g1", "card:p2", "card:p3"]);
});

check("silence: 1 day is quiet, 2 is High, 7 is Critical", () => {
  const rows = (days: number) =>
    buildToday(input({ lastPosted: [{ platform: "x", at: new Date(NOW.getTime() - days * 86_400_000).toISOString() }] })).rows;
  assert.equal(rows(1).length, 0);
  assert.equal(rows(2)[0]!.level, "high");
  assert.equal(rows(6)[0]!.level, "high");
  assert.equal(rows(7)[0]!.level, "critical");
  assert.equal(rows(2)[0]!.title, "X: nothing posted for 2 days");
});

check("days count in the founder's time zone, at midnight", () => {
  // 23:30 in Ho Chi Minh City on 9 Nov is 16:30 UTC; 00:30 on 11 Nov there is 17:30 UTC on 10 Nov.
  assert.equal(daysBetween("2026-11-09T16:30:00Z", new Date("2026-11-10T17:30:00Z"), "Asia/Ho_Chi_Minh"), 2);
  assert.equal(daysBetween("2026-11-09T16:30:00Z", new Date("2026-11-10T17:30:00Z"), "UTC"), 1);
  // A card that expires at 23:00 local is "today"; one expiring after local midnight is not.
  const tz = "America/New_York"; // 09:00 UTC is 04:00 there.
  const today = buildToday(
    input({
      timezone: tz,
      cards: [
        card("tonight", "schedule", "2026-11-09T08:00:00Z", { expiresAt: "2026-11-11T03:59:00Z" }),
        card("tomorrow", "schedule", "2026-11-09T09:00:00Z", { expiresAt: "2026-11-11T05:01:00Z" }),
      ],
    }),
  );
  assert.equal(today.rows[0]!.reason, "expiring");
  assert.equal(today.rows[0]!.id, "card:tonight");
  assert.equal(today.rows[1]!.reason, "waiting");
});

check("the connection row shows only for platforms the loader found blocked", () => {
  assert.equal(buildToday(input()).rows.some((row) => row.reason === "setup"), false);
  const today = buildToday(input({ needsAccount: ["x"] }));
  assert.equal(today.rows[0]!.title, "Connect X so tomorrow's post can go out");
  assert.equal(today.rows[0]!.action.type, "link");
});

check("a failed slot without its card waiting is left out", () => {
  const today = buildToday(input({ failedSlots: [{ id: "s", platform: "x", title: "t", at: "2026-11-10T08:00:00Z", approvalId: "gone" }] }));
  assert.equal(today.rows.length, 0);
});

check("first-run rows: strategy, then rating", () => {
  const today = buildToday(input({ firstRun: { readStrategy: true, rateDrafts: true } }));
  assert.deepEqual(today.rows.map((row) => row.title), ["Ready to read: your marketing strategy", "Rate your first drafts"]);
  assert.ok(TodaySchema.safeParse(today).success);
});

check("platforms as rows spell them", () => {
  assert.equal(todayPlatform("X"), "x");
  assert.equal(todayPlatform("LinkedIn"), "linkedin");
  assert.equal(todayPlatform("twitter"), "x");
  assert.equal(todayPlatform("reddit"), null);
  assert.equal(todayPlatform(3), null);
});

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("today.check: every check passed");
