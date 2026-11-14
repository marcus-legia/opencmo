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
import { enqueueDueDrafts, enqueueDueLoops, loopHour, loopKey } from "./schedule";

type Row = Record<string, unknown>;
const MAX_ROWS = 1000;
const MAX_IN = 300;

/** `input->>source` reads `row.input.source`. */
const read = (row: Row, column: string): unknown => {
  const [head, key] = column.split("->>");
  return key ? (row[head!] as Row | null)?.[key] : row[column];
};

function fakeAdmin(tables: Record<string, Row[]>, paid: Set<string>) {
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
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => {
        const rows = (tables[table] ?? []).filter((row) => tests.every((test) => test(row)));
        return Promise.resolve({ data: rows.slice(window[0], Math.min(window[1] + 1, window[0] + MAX_ROWS)), error: null }).then(resolve);
      },
    };
    return query;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "cmo_paid_users") return { data: (args.p_users as string[]).filter((id) => paid.has(id)), error: null };
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
  assert.equal(await enqueueDueDrafts(one, "u", xs), 3, "three X items on a day are three runs, the fourth waits");
  assert.deepEqual(day.cmo_runs!.map((run) => (run.input as Row).item_id), ["a", "b", "c"], "the oldest first");

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
