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
import { enqueueDueLoops, loopKey } from "./schedule";

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
    profiles: founders.map((id) => ({ id, credit_balance: 50 })),
    work_orders: [],
    social_accounts: [],
    cmo_draft_outcomes: [],
    cmo_runs: [],
  };
  // The last founder has no plan and no credits: no loop for them.
  const { admin } = fakeAdmin(tables, new Set(founders.slice(0, -1)));

  const first = await enqueueDueLoops(admin);
  assert.equal(first.users, 1200, "every founder is read, past PostgREST's 1000 rows");
  const drafts = tables.cmo_runs!.filter((run) => run.kind === "post_draft");
  assert.equal(drafts.length, 1199, "each paid founder's due post has its draft");
  assert.equal(new Set(drafts.map((run) => run.user_id)).size, 1199, "one draft each");
  const last = drafts.find((run) => run.user_id === "user-1198")!.input as Row;
  assert.deepEqual([last.source, last.loop, last.item_id], ["schedule", "daily-x-draft", "item-1198"], "the draft names its calendar item");
  assert.equal(first.queued, tables.cmo_runs!.length);

  // The cron is retried after a timeout, or called again later in the day: the runs of the first call have finished
  // (`cmo_enqueue` would no longer merge them), and nothing is queued twice.
  for (const run of tables.cmo_runs!) run.status = "done";
  const again = await enqueueDueLoops(admin);
  assert.equal(again.queued, 0, "a second call the same day queues nothing");
  assert.equal(tables.cmo_runs!.length, first.queued);

  // A call that stopped halfway picks up where it left off: only the founders it missed get their runs.
  tables.cmo_runs = tables.cmo_runs!.filter((run) => run.user_id !== "user-0007");
  const { admin: resumed } = fakeAdmin(tables, new Set(founders.slice(0, -1)));
  const rest = await enqueueDueLoops(resumed);
  assert.ok(rest.queued >= 1, "the missed founder is queued");
  assert.equal(tables.cmo_runs.filter((run) => run.user_id === "user-0007" && run.kind === "post_draft").length, 1);
  assert.equal(tables.cmo_runs.filter((run) => run.kind === "post_draft").length, 1199);

  // Yesterday's run does not stand in for today's.
  assert.notEqual(loopKey("u", "weekly-plan"), loopKey("u", "daily-x-draft", "item"));
  for (const run of tables.cmo_runs) run.created_at = `${isoDay(-1)}T00:05:00.000Z`;
  const tomorrow = await enqueueDueLoops(resumed);
  assert.ok(tomorrow.queued >= 1199, "a new day queues the loops again");

  console.log("schedule.check — paged reads, 1200 founders, one run per loop a day, a retry resumes.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
