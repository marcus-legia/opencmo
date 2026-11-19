/**
 * The reach levels (wave 3 A1):
 *
 *     cd apps/web && npx tsx lib/cmo/reach.check.ts
 *
 * Reply first is the default; DM ready and Email ready need every check the owner agreed on (redesign plan, 2026-11-19).
 */
import assert from "node:assert/strict";

import { LibraryEntrySchema } from "./library";
import { ReachCheckSchema, isFresh, platformHasDms, reachLevel, type ReachCheck } from "./reach";

const failures: string[] = [];
function check(label: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const ready: ReachCheck = {
  buyer: true, wantsNow: true, warm: true, fresh: true, dmAllowed: true, asksForTools: false,
  emailFound: null, reasons: [],
};

check("a person with every DM check is DM ready", () => assert.equal(reachLevel(ready), "dm_ready"));
check("a post asking for tools stands in for warm for a DM", () =>
  assert.equal(reachLevel({ ...ready, warm: false, asksForTools: true }), "dm_ready"));
check("neither warm nor asking for tools is reply first", () =>
  assert.equal(reachLevel({ ...ready, warm: false }), "reply_first"));
for (const key of ["buyer", "wantsNow", "fresh", "dmAllowed"] as const) {
  check(`without ${key} it is reply first`, () => assert.equal(reachLevel({ ...ready, [key]: false }), "reply_first"));
}
check("an address and warm make email ready", () =>
  assert.equal(reachLevel({ ...ready, emailFound: "sam@studio.example" }), "email_ready"));
check("an address without warm stays DM ready, even when the post asks for tools", () =>
  assert.equal(reachLevel({ ...ready, warm: false, asksForTools: true, emailFound: "sam@studio.example" }), "dm_ready"));
check("an address alone never skips the DM checks", () =>
  assert.equal(reachLevel({ ...ready, dmAllowed: false, emailFound: "sam@studio.example" }), "reply_first"));

check("fresh means under 7 days, and an unknown date is not fresh", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  assert.equal(isFresh("2026-11-14T12:00:01Z", now), true);
  assert.equal(isFresh("2026-11-13T12:00:00Z", now), false);
  assert.equal(isFresh(null, now), false);
  assert.equal(isFresh("not a date", now), false);
  assert.equal(isFresh("2026-11-21T12:00:00Z", now), false);
});
check("Hacker News has no DMs", () => {
  assert.equal(platformHasDms("hn"), false);
  assert.equal(platformHasDms("reddit"), true);
});

check("the reach schema rejects a bad address and takes a good check", () => {
  assert.equal(ReachCheckSchema.safeParse({ ...ready, emailFound: "not-an-email" }).success, false);
  assert.equal(ReachCheckSchema.safeParse(ready).success, true);
});
check("a Library entry keeps quotes short", () => {
  const entry = {
    opportunityId: "00000000-0000-4000-8000-000000000001", platform: "reddit", community: "r/freelance",
    postedAt: null, summary: "Chasing three late invoices by hand every month", themeId: null,
    quotes: [{ kind: "pain", text: "I spend Fridays chasing invoices" }],
  };
  assert.equal(LibraryEntrySchema.safeParse(entry).success, true);
  assert.equal(LibraryEntrySchema.safeParse({ ...entry, quotes: [{ kind: "pain", text: "x".repeat(281) }] }).success, false);
});

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("reach: ok");
