/**
 * The spend ledger's write side: records only inside `withSpend`, with the right RPC for the caller; refuses past the
 * cap before a call; a failed write never throws into the job.
 *
 *     tsx lib/spend/spend.check.ts
 */
import assert from "node:assert/strict";

import type { SupabaseClient } from "@/lib/api/handler";

import { assertSpendAllowed, recordSpend, SpendCapError, spendAllowed, spendProviderOf, withSpend } from "./record";

type Call = { name: string; args: Record<string, unknown> };

function client(calls: Call[], opts: { allowed?: boolean; fail?: boolean } = {}): SupabaseClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (opts.fail) return { data: null, error: { message: "boom" } };
      if (name.startsWith("provider_spend_allowed")) return { data: opts.allowed ?? true, error: null };
      return { data: 0, error: null };
    },
  } as unknown as SupabaseClient;
}

async function main() {
  // Outside a context: nothing recorded, nothing refused (evals, checks).
  await recordSpend("scrapecreators", "/v1/reddit/search", { call: 1 });
  assert.equal(await spendAllowed(), true);

  const calls: Call[] = [];
  const service = client(calls);
  await withSpend({ via: "service", client: service, userId: "u1", refKind: "cmo_run", refId: "r1" }, async () => {
    await assertSpendAllowed();
    await recordSpend("anthropic", "claude-sonnet-5-5", { input: 10, output: 2, cache_read: 0, cache_write: 0 });
  });
  assert.deepEqual(calls.map((call) => call.name), ["provider_spend_allowed_for", "provider_usage_record"]);
  assert.deepEqual(calls[1]!.args, { p_user: "u1", p_provider: "anthropic", p_model: "claude-sonnet-5-5", p_units: { input: 10, output: 2, cache_read: 0, cache_write: 0 }, p_ref_kind: "cmo_run", p_ref_id: "r1" });

  // A founder's client records only their own lookups, through the RPC that prices them on the server.
  const mine: Call[] = [];
  await withSpend({ via: "founder", client: client(mine), refKind: "agent_turn" }, async () => {
    await recordSpend("scrapecreators", "/v1/twitter/profile", { call: 1 });
    await recordSpend("anthropic", "claude-sonnet-5-5", { input: 1 });
  });
  assert.deepEqual(mine, [{ name: "provider_usage_record_mine", args: { p_endpoint: "/v1/twitter/profile", p_calls: 1, p_ref_kind: "agent_turn" } }]);

  // Past the cap: refused before the call.
  await assert.rejects(withSpend({ via: "service", client: client([], { allowed: false }), userId: "u1", refKind: "cmo_run" }, assertSpendAllowed), SpendCapError);
  // A ledger that cannot be written never fails the work.
  await withSpend({ via: "service", client: client([], { fail: true }), userId: "u1", refKind: "cmo_run" }, () => recordSpend("scrapecreators", "/v1/x", { call: 1 }));

  assert.equal(spendProviderOf("anthropic"), "anthropic");

  console.log("spend.check ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
