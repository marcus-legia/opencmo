/**
 * The provider spend ledger's write side (docs/plans/cmo/2026-11-02-provider-spend-ledger-plan.md).
 *
 * Work that spends on a founder's behalf (a CMO job, a chat or MCP research call) runs inside `withSpend`, which names
 * the founder and the work. Deep inside, `scGet` and `structured()` read that context: they ask `spendAllowed()` before
 * a paid call and `recordSpend()` after it, so no call site threads a recorder through. Outside a context (evals,
 * checks) nothing is recorded and nothing is refused.
 *
 * Recording never breaks the founder's result: a failed write is logged, never thrown. Only the cap check refuses,
 * and it refuses before the money is spent.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import type { SupabaseClient } from "@/lib/api/handler";

export type SpendProvider = "anthropic" | "scrapecreators";
export type SpendRefKind = "cmo_run" | "agent_turn" | "mcp";

/**
 * `service`: the CMO runner's own service-role client, which records for `userId` with any provider. `founder`: the
 * founder's RLS client (chat, MCP), which can only record their own ScrapeCreators lookups at the server's price.
 */
export type SpendContext =
  | { via: "service"; client: SupabaseClient; userId: string; refKind: SpendRefKind; refId?: string }
  | { via: "founder"; client: SupabaseClient; refKind: "agent_turn" | "mcp" };

export const SPEND_CAP_MESSAGE = "Your CMO reached today's limit. It will continue tomorrow.";

export class SpendCapError extends Error {
  constructor() {
    super(SPEND_CAP_MESSAGE);
  }
}

const store = new AsyncLocalStorage<SpendContext>();

export function withSpend<T>(context: SpendContext, run: () => Promise<T>): Promise<T> {
  return store.run(context, run);
}

/** False once the founder's spend today reached the cap. A failed check lets the call through: the ledger is a guard, not the gate to the product. */
export async function spendAllowed(): Promise<boolean> {
  const context = store.getStore();
  if (!context) return true;
  const { data, error } =
    context.via === "service"
      ? await context.client.rpc("provider_spend_allowed_for", { p_user: context.userId })
      : await context.client.rpc("provider_spend_allowed", {});
  if (error) {
    console.error("[spend] cap check failed", error.message);
    return true;
  }
  return data !== false;
}

/** Throws `SpendCapError` past the cap. */
export async function assertSpendAllowed(): Promise<void> {
  if (!(await spendAllowed())) throw new SpendCapError();
}

/** Units: tokens for models ({input, output, cache_read, cache_write}); `{call: 1}` for a billed lookup, `{call: 0}` for one that was not. */
export async function recordSpend(provider: SpendProvider, modelOrEndpoint: string, units: Record<string, number>): Promise<void> {
  const context = store.getStore();
  if (!context) return;
  try {
    if (context.via === "service") {
      const { error } = await context.client.rpc("provider_usage_record", {
        p_user: context.userId,
        p_provider: provider,
        p_model: modelOrEndpoint,
        p_units: units,
        p_ref_kind: context.refKind,
        p_ref_id: context.refId ?? null,
      });
      if (error) throw error;
    } else if (provider === "scrapecreators") {
      const { error } = await context.client.rpc("provider_usage_record_mine", { p_endpoint: modelOrEndpoint, p_calls: units.call ? 1 : 0, p_ref_kind: context.refKind });
      if (error) throw error;
    }
  } catch (error) {
    console.error("[spend] could not record", provider, modelOrEndpoint, error instanceof Error ? error.message : error);
  }
}

/** The ledger's name for a CMO model provider. */
export function spendProviderOf(provider: "anthropic"): SpendProvider {
  return provider;
}
