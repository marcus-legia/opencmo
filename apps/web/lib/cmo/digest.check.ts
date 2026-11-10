/**
 * The morning email starts with Today (CMO review 3, 1.3): the top three rows in Today's order, "N more waiting", and
 * the old waiting list only on a day without rows. Links only open things.
 *
 *     cd apps/web && npx tsx lib/cmo/digest.check.ts
 */
import assert from "node:assert/strict";

import { buildDigest, type DigestInput } from "./digest";
import { buildToday, type TodayInput } from "./today";

const failures: string[] = [];
function check(name: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const NOW = new Date("2026-11-10T07:00:00Z");
const todayInput = (extra: Partial<TodayInput>): TodayInput => ({
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
const base: DigestInput = { appUrl: "https://opencmo.io/", dateLabel: "Tuesday 10 Nov", waiting: [], wentOut: [], stuck: [] };

const cards = Array.from({ length: 6 }, (_, i) => ({
  id: `c${i}`,
  kind: i % 2 ? "reply" : "post",
  department: (i % 2 ? "sales" : "writer") as "sales" | "writer",
  title: `Card number ${i}`,
  platform: null,
  raisedAt: `2026-11-0${i + 1}T08:00:00Z`,
  expiresAt: null,
}));

check("the top three rows in Today's order, then N more waiting", () => {
  const today = buildToday(todayInput({ cards, lastPosted: [{ platform: "x", at: "2026-11-01T08:00:00Z" }] }));
  const digest = buildDigest({
    ...base,
    waiting: cards.map((c) => ({ id: c.id, title: c.title, department: c.department })),
    today: { rows: today.rows, open: today.total - today.done },
  });
  const lines = digest.text.split("\n");
  const start = lines.indexOf("Today:");
  assert.ok(start > 0, "the email starts with Today");
  assert.equal(lines[start + 1], "- X: nothing posted for 9 days");
  assert.equal(lines[start + 3], "- Card number 0");
  assert.equal(lines[start + 5], "- Card number 1");
  assert.ok(digest.text.includes("4 more waiting: https://opencmo.io/app"), digest.text);
  assert.ok(!digest.text.includes("Waiting on you:"), "the full list is replaced by Today");
  assert.ok(digest.html.indexOf("Today") < digest.html.indexOf("4 more waiting"));
  assert.ok(
    digest.html.includes('href="https://opencmo.io/app?ask=1&amp;prompt=Write%20me%20a%20post%20for%20X%20for%20today."'),
    "a chat row opens the chat with the request in its box; it sends nothing",
  );
  assert.ok(digest.html.includes('href="https://opencmo.io/app/inbox/c0"'), "a card row opens the card");
  assert.ok(![...digest.html.matchAll(/href="([^"]*)"/g)].some(([, href]) => /approve|decide/i.test(href!)), "no link decides anything");
  assert.equal(digest.subject, "6 things wait on you · Tuesday 10 Nov");
});

check("three rows or fewer: no 'more' line", () => {
  const today = buildToday(todayInput({ cards: cards.slice(0, 2) }));
  const digest = buildDigest({ ...base, waiting: cards.slice(0, 2).map((c) => ({ id: c.id, title: c.title, department: c.department })), today: { rows: today.rows, open: today.total - today.done } });
  assert.ok(!digest.text.includes("more waiting"));
  assert.equal(digest.text.split("\n").filter((line) => line.startsWith("- Card")).length, 2);
});

check("an empty day says so and is empty", () => {
  const today = buildToday(todayInput({}));
  const digest = buildDigest({ ...base, today: { rows: today.rows, open: 0 } });
  assert.equal(digest.empty, true);
  assert.ok(digest.text.includes("Nothing waits on you."));
  assert.ok(!digest.text.includes("Today:"));
});

check("a card the email's claim dropped is not listed, and the count says so", () => {
  const today = buildToday(todayInput({ cards: cards.slice(0, 5) }));
  const digest = buildDigest({
    ...base,
    waiting: cards.slice(1, 5).map((c) => ({ id: c.id, title: c.title, department: c.department })),
    today: { rows: today.rows, open: today.total - today.done },
  });
  assert.ok(!digest.text.includes("Card number 0"));
  assert.ok(digest.text.includes("- Card number 1"));
  assert.ok(digest.text.includes("1 more waiting"), digest.text);
});

check("titles are escaped in the HTML", () => {
  const today = buildToday(todayInput({ cards: [{ ...cards[0]!, title: "<script>x</script>" }] }));
  const digest = buildDigest({ ...base, waiting: [{ id: "c0", title: "<script>x</script>", department: "writer" }], today: { rows: today.rows, open: 1 } });
  assert.ok(!digest.html.includes("<script>"));
  assert.ok(digest.html.includes("&lt;script&gt;"));
});

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("digest.check: every check passed");
