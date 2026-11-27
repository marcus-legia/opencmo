/**
 * The daily schedule against a stand-in for PostgREST that answers at most 1000 rows and refuses a long `in` filter,
 * as the real one does: every founder gets their loops past those limits, and a second call the same day queues
 * nothing.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/schedule.check.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isoDay } from "./jobs/types";
import { BACKLOG_MAX, backlogRoom, daySlots, draftWave, enqueueDueDrafts, enqueueDueLoops, loopHour, loopKey } from "./schedule";

type Row = Record<string, unknown>;
const MAX_ROWS = 1000;
const MAX_IN = 300;

/** `input->>source` reads `row.input.source`. */
const read = (row: Row, column: string): unknown => {
  const [head, key] = column.split("->>");
  return key ? (row[head!] as Row | null)?.[key] : row[column];
};

function fakeAdmin(tables: Record<string, Row[]>, paid: Set<string>, fill?: (args: Record<string, unknown>) => Row[]) {
  const calls = { in: 0 };
  const from = (table: string) => {
    const tests: ((row: Row) => boolean)[] = [];
    let window: [number, number] = [0, MAX_ROWS - 1];
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      eq: (column: string, value: unknown) => (tests.push((row) => read(row, column) === value), query),
      is: (column: string, value: unknown) => (tests.push((row) => (read(row, column) ?? null) === value), query),
      lte: (column: string, value: string) => (tests.push((row) => String(read(row, column)) <= value), query),
      gte: (column: string, value: string) => (tests.push((row) => String(read(row, column)) >= value), query),
      in: (column: string, values: unknown[]) => {
        calls.in += 1;
        assert.ok(values.length <= MAX_IN, `an in() filter of ${values.length} values is a URL PostgREST refuses`);
        tests.push((row) => values.includes(read(row, column)));
        return query;
      },
      range: (start: number, end: number) => ((window = [start, end]), query),
      then: (resolve: (value: { data: Row[]; count: number; error: null }) => unknown) => {
        const rows = (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
        return Promise.resolve({ data: rows.slice(window[0], Math.min(window[1] + 1, window[0] + MAX_ROWS)), count: rows.length, error: null }).then(resolve);
      },
    };
    return query;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "cmo_paid_users") return { data: (args.p_users as string[]).filter((id) => paid.has(id)), error: null };
    if (name === "cmo_fill_day_slots") return { data: fill ? fill(args) : [], error: null };
    assert.equal(name, "enqueue_cmo_run_for");
    const run = { id: `run-${tables.cmo_runs!.length}`, user_id: args.p_user, kind: args.p_kind, input: args.p_input, status: "queued", created_at: new Date().toISOString() };
    tables.cmo_runs!.push(run);
    return { data: run, error: null };
  };
  return { admin: { from, rpc } as unknown as SupabaseClient, calls };
}

async function main() {
  const today = isoDay();
  const founders = Array.from({ length: 1200 }, (_, i) => `user-${String(i).padStart(4, "0")}`);
  const tables: Record<string, Row[]> = {
    marketing_documents_latest: founders.flatMap((user_id) => [
      { user_id, kind: "product", body: {} },
      { user_id, kind: "competitors", body: { competitors: [] } },
    ]),
    content_items: founders.map((user_id, i) => ({ id: `item-${i}`, user_id, department: "post", status: "planned", idea: "A post", day: today, platform: "X" })),
    // Every fourth founder is in California, the others in Vietnam.
    profiles: founders.map((id, i) => ({ id, credit_balance: 50, timezone: i % 4 === 3 ? "America/Los_Angeles" : "Asia/Ho_Chi_Minh" })),
    work_orders: [],
    social_accounts: [],
    cmo_draft_outcomes: [],
    cmo_runs: [],
  };
  // The last founder has no plan and no credits: no loop for them.
  const { admin } = fakeAdmin(tables, new Set(founders.slice(0, -1)));

  // A founder's loops start at 06:00 where they are, or at 00:00 UTC when that is already past.
  const winter = new Date("2026-01-15T10:00:00Z");
  assert.equal(loopHour("Asia/Ho_Chi_Minh", winter), 0, "07:00 in Vietnam, as before");
  assert.equal(loopHour("UTC", winter), 6);
  assert.equal(loopHour("Europe/Berlin", winter), 5);
  assert.equal(loopHour("America/New_York", winter), 11, "06:00 in New York");
  assert.equal(loopHour("America/Los_Angeles", winter), 14, "06:00 in California");
  assert.equal(loopHour("America/Los_Angeles", new Date("2026-07-15T10:00:00Z")), 13, "an hour earlier in summer time");
  assert.equal(loopHour("Pacific/Auckland", winter), 0);
  assert.equal(loopHour("Pacific/Honolulu", winter), 16);
  assert.equal(loopHour("Not/AZone", winter), 0, "an unknown timezone runs at the start of the day");
  assert.equal(loopHour(null, winter), 6);

  const at = (hour: number) => new Date(`${today}T${String(hour).padStart(2, "0")}:05:00Z`);
  const early = await enqueueDueLoops(admin, at(0));
  assert.deepEqual([early.users, early.waiting], [900, 300], "at 00:05 UTC only Vietnam is up; California waits");
  assert.equal(tables.cmo_runs!.filter((run) => run.kind === "post_draft").length, 900);
  const noon = await enqueueDueLoops(admin, at(12));
  assert.equal(noon.queued, 0, "nothing new until California's morning");

  const first = await enqueueDueLoops(admin, at(23));
  assert.equal(first.users, 1200, "every founder is read, past PostgREST's 1000 rows");
  const drafts = tables.cmo_runs!.filter((run) => run.kind === "post_draft");
  assert.equal(drafts.length, 1199, "each paid founder's due post has its draft");
  assert.equal(new Set(drafts.map((run) => run.user_id)).size, 1199, "one draft each");
  const last = drafts.find((run) => run.user_id === "user-1198")!.input as Row;
  assert.deepEqual([last.source, last.loop, last.item_id], ["schedule", "daily-post-draft", "item-1198"], "the draft names its calendar item");
  assert.equal(early.queued + first.queued, tables.cmo_runs!.length);
  const total = tables.cmo_runs!.length;

  // The cron is retried after a timeout, or called again later in the day: the runs of the first call have finished
  // (`cmo_enqueue` would no longer merge them), and nothing is queued twice.
  for (const run of tables.cmo_runs!) run.status = "done";
  const again = await enqueueDueLoops(admin, at(23));
  assert.equal(again.queued, 0, "a second call the same day queues nothing");
  assert.equal(tables.cmo_runs!.length, total);

  // A call that stopped halfway picks up where it left off: only the founders it missed get their runs.
  tables.cmo_runs = tables.cmo_runs!.filter((run) => run.user_id !== "user-0007");
  const { admin: resumed } = fakeAdmin(tables, new Set(founders.slice(0, -1)));
  const rest = await enqueueDueLoops(resumed, at(23));
  assert.ok(rest.queued >= 1, "the missed founder is queued");
  assert.equal(tables.cmo_runs.filter((run) => run.user_id === "user-0007" && run.kind === "post_draft").length, 1);
  assert.equal(tables.cmo_runs.filter((run) => run.kind === "post_draft").length, 1199);

  // Yesterday's run does not stand in for today's.
  assert.notEqual(loopKey("u", "weekly-plan"), loopKey("u", "daily-x-draft", "item"));
  for (const run of tables.cmo_runs) run.created_at = `${isoDay(-1)}T00:05:00.000Z`;
  const tomorrow = await enqueueDueLoops(resumed, at(23));
  assert.ok(tomorrow.queued >= 1199, "a new day queues the loops again");

  // One run per due item, not per platform: X at 2 or 3 a day drafts every X slot (daily core drafts, 2026-11-12),
  // up to the planner's most posts a day.
  const day: Record<string, Row[]> = { work_orders: [], cmo_runs: [] };
  const { admin: one } = fakeAdmin(day, new Set());
  const xs = ["a", "b", "c", "d"].map((id) => ({ id, platform: "X" }));
  assert.equal(await enqueueDueDrafts(one, "u", [...xs, { id: "e", platform: "X" }, { id: "f", platform: "X" }]), 5, "five X items on a day are five runs, the sixth waits");
  assert.deepEqual(day.cmo_runs!.map((run) => (run.input as Row).item_id), ["a", "b", "c", "d", "e"], "the oldest first");

  // A7 (2026-11-27): X takes five a day; the oldest day first, then the day's slots in order.
  const five: Record<string, Row[]> = { work_orders: [], cmo_runs: [], content_items: [] };
  const { admin: fiveAdmin } = fakeAdmin(five, new Set());
  const slotted = [4, 2, 0, 3, 1, 5].map((slot) => ({ id: `s${slot}`, platform: "X", day: today, slot }));
  assert.equal(await enqueueDueDrafts(fiveAdmin, "u", [{ id: "old", platform: "X", day: isoDay(-1), slot: 2 }, ...slotted]), 5);
  assert.deepEqual(five.cmo_runs!.map((run) => (run.input as Row).item_id), ["old", "s0", "s1", "s2", "s3"], "yesterday first, then by slot");

  // Two waves: the first half of the day's slots from the morning, the rest six hours on, never past 23:00 UTC.
  assert.deepEqual([0, 1, 2, 3, 4].map((slot) => draftWave(slot, 5, 0, 0)), [true, true, true, false, false], "5 slots: 3 in the morning");
  assert.deepEqual([3, 4].map((slot) => draftWave(slot, 5, 6, 0)), [true, true], "the rest six hours on");
  assert.equal(draftWave(1, 2, 18, 14), false, "California's second post waits for 20:00 UTC");
  assert.equal(draftWave(1, 2, 23, 20), true, "a late morning's second wave is at 23:00 UTC at the latest");
  assert.equal(draftWave(undefined, 5, 0, 0), true, "an item with no slot is in the first wave");
  assert.equal(draftWave(0, 1, 0, 0), true);
  const waves: Record<string, Row[]> = { work_orders: [], cmo_runs: [], content_items: [] };
  const { admin: waveAdmin } = fakeAdmin(waves, new Set());
  const daySet = [0, 1, 2, 3].map((slot) => ({ id: `w${slot}`, platform: "X", day: today, slot }));
  assert.equal(await enqueueDueDrafts(waveAdmin, "u", daySet, { wave: { n: 4, hour: 2, loopHour: 0, today } }), 2, "morning: two of four");
  const done = new Set(waves.cmo_runs!.map((run) => loopKey("u", "daily-post-draft", (run.input as Row).item_id as string)));
  assert.equal(await enqueueDueDrafts(waveAdmin, "u", daySet, { done, wave: { n: 4, hour: 6, loopHour: 0, today } }), 2, "six hours on: the other two");
  const overdue: Record<string, Row[]> = { work_orders: [], cmo_runs: [], content_items: [] };
  assert.equal(await enqueueDueDrafts(fakeAdmin(overdue, new Set()).admin, "u", [{ id: "y3", platform: "X", day: isoDay(-1), slot: 3 }],
    { wave: { n: 4, hour: 0, loopHour: 0, today } }), 1, "yesterday's late slot is drafted in the first wave");
  const fiveDone = new Set(["p1", "p2", "p3", "p4", "p5"].map((id) => loopKey("u", "daily-post-draft", id)));
  assert.equal(await enqueueDueDrafts(waveAdmin, "u", [{ id: "late", platform: "X", day: today, slot: 0 }], { done: fiveDone }), 0,
    "five drafts queued earlier today: the day's cap is spent, whatever is still planned");

  // The backlog guard (decision 6): ten drafts in review stop new drafts; nine leave room for one.
  assert.deepEqual([backlogRoom(0), backlogRoom(9), backlogRoom(BACKLOG_MAX), backlogRoom(14), backlogRoom(-1)], [10, 1, 0, 0, 10]);
  const review = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, user_id: "u", department: "post", status: "in_review" }));
  for (const [waiting, want] of [[10, 0], [9, 1]] as const) {
    const full: Record<string, Row[]> = { work_orders: [], cmo_runs: [], content_items: review(waiting) };
    const { admin: fullAdmin } = fakeAdmin(full, new Set());
    assert.equal(await enqueueDueDrafts(fullAdmin, "u", xs), want, `${waiting} drafts waiting: ${want} new`);
  }

  // A6: today's slots as the week plan reads them; a platform with no account has none.
  assert.deepEqual(daySlots({ text: { x: 3, threads: 1, linkedin: 0, facebook: 0 }, video: {} }, ["x", "threads"], []),
    [{ slot: 0, targets: ["x", "threads"] }, { slot: 1, targets: ["x"] }, { slot: 2, targets: ["x"] }]);
  assert.deepEqual(daySlots({ text: { x: 3, threads: 1, linkedin: 0, facebook: 0 }, video: {} }, ["threads"], []), [{ slot: 0, targets: ["threads"] }]);
  // The schedule fills today's empty slots (not on Monday) and drafts what it made in the same call.
  const tuesday = new Date("2026-12-01T03:00:00Z");
  const filled: Record<string, Row[]> = {
    marketing_documents_latest: [{ user_id: "f", kind: "product", body: {} }],
    content_items: [{ id: "planned-0", user_id: "f", department: "post", status: "planned", idea: "A post", day: "2026-12-01", platform: "X", slot: 0 }],
    profiles: [{ id: "f", timezone: "Asia/Ho_Chi_Minh", posting_plan: { text: { x: 2, threads: 0, linkedin: 0, facebook: 0 }, video: {} } }],
    social_accounts: [{ id: "a", user_id: "f", platform: "x", status: "connected" }],
    work_orders: [], cmo_draft_outcomes: [], cmo_runs: [],
  };
  const fills: Record<string, unknown>[] = [];
  // As the RPC: the made item is a planned row, and a second call makes nothing.
  const { admin: fillAdmin } = fakeAdmin(filled, new Set(["f"]), (args) => {
    fills.push(args);
    if (filled.content_items!.some((i) => i.id === "made-1")) return [];
    filled.content_items!.push({ id: "made-1", user_id: "f", department: "post", status: "planned", idea: "Today's post", day: "2026-12-01", platform: "X", slot: 1 });
    return [{ id: "made-1", slot: 1 }];
  });
  await enqueueDueLoops(fillAdmin, tuesday);
  assert.deepEqual(fills.map((a) => [a.p_day, a.p_items]), [["2026-12-01", [{ slot: 0, targets: ["x"] }, { slot: 1, targets: ["x"] }]]]);
  const drafted = () => filled.cmo_runs!.filter((r) => r.kind === "post_draft").map((r) => (r.input as Row).item_id);
  assert.deepEqual(drafted(), ["planned-0"], "03:00 UTC: Vietnam's first wave (from 00:00) drafts slot 0; the filled slot 1 waits");
  for (const run of filled.cmo_runs!) run.created_at = tuesday.toISOString();
  await enqueueDueLoops(fillAdmin, new Date("2026-12-01T07:00:00Z"));
  assert.deepEqual(drafted(), ["planned-0", "made-1"], "from 06:00 UTC the second wave drafts the filled slot");
  const monday: Record<string, Row[]> = { ...filled, cmo_runs: [] };
  fills.length = 0;
  await enqueueDueLoops(fakeAdmin(monday, new Set(["f"]), (args) => (fills.push(args), [])).admin, new Date("2026-11-30T03:00:00Z"));
  assert.equal(fills.length, 0, "Monday's week plan fills its own slots");

  // A day in flight when the loop was renamed is not drafted twice: yesterday's name still counts for today.
  const renamed: Record<string, Row[]> = {
    ...tables,
    cmo_runs: founders.map((user_id, i) => ({ id: `old-${i}`, user_id, kind: "post_draft", status: "done", created_at: `${today}T00:05:00.000Z`, input: { source: "schedule", loop: "daily-x-draft", item_id: `item-${i}` } })),
  };
  const { admin: legacy } = fakeAdmin(renamed, new Set(founders.slice(0, -1)));
  await enqueueDueLoops(legacy, at(23));
  assert.equal(renamed.cmo_runs!.filter((run) => String(run.id).startsWith("run-") && run.kind === "post_draft").length, 0, "the old loop name's runs count");

  console.log("schedule.check — paged reads, 1200 founders, each from their own morning, one run per loop a day, a retry resumes.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
