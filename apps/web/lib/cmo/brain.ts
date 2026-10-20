/**
 * Who thinks for a founder right now (docs/mcp-on-modal-plan.md, "Mode switch").
 *
 * `opencmo`: our model keys (`lib/cmo/agents/registry.ts`), paid with agent credits. `claude`: the founder's own Claude
 * over MCP; the CMO cron writes to the inbox and the Assistant shows "Continue in Claude". It is
 * `claude` when the founder cannot pay for one Assistant turn, or when neither provider can answer
 * for an account reason (no key, a revoked key, no balance). A busy provider is not a reason:
 * it passes in a minute, and failover already covers it.
 *
 * No `server-only`: `brain.check.ts` runs the pure part with tsx.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { AGENT_HOLD_CREDITS } from "@/lib/agent/limits";
import { agentCandidates } from "@/lib/cmo/agents/registry";
import { accountDown, type LlmProvider } from "@/lib/llm-health";
import { isProduction } from "@/lib/production";

import type { Brain } from "./jobs/types";

export type BrainReason = "ok" | "credits" | "llm_down" | "forced";
export type BrainMode = { brain: Brain; reason: BrainReason; credits: number };

/** The decision itself, from what is known; `providersUp` counts providers with a key that is not down. */
export function decideBrain(input: { credits: number; providersUp: number; forced?: boolean }): BrainMode {
  const { credits } = input;
  if (input.forced) return { brain: "claude", reason: "forced", credits };
  if (input.providersUp === 0) return { brain: "claude", reason: "llm_down", credits };
  if (credits < AGENT_HOLD_CREDITS) return { brain: "claude", reason: "credits", credits };
  return { brain: "opencmo", reason: "ok", credits };
}

/** Providers with a shared key on this server that no recent call found out of credit or revoked. */
export function providersUp(env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): number {
  return agentCandidates("planner", env).filter((agent) => !accountDown(agent.provider as LlmProvider, now)).length;
}

/** Dev and e2e only: `OPENCMO_BRAIN=claude` runs the inbox path with the keys still set. */
const forcedClaude = (env: NodeJS.ProcessEnv = process.env): boolean => env.OPENCMO_BRAIN === "claude" && !isProduction();

/** Works with the founder's own client (RLS: their profile) or the service role. */
export async function brainMode(supabase: SupabaseClient, userId: string): Promise<BrainMode> {
  const { data, error } = await supabase.from("profiles").select("credit_balance").eq("id", userId).maybeSingle();
  if (error) throw new Error(`profiles: ${error.message}`);
  const credits = Number((data as { credit_balance?: number } | null)?.credit_balance ?? 0);
  return decideBrain({ credits, providersUp: providersUp(), forced: forcedClaude() });
}

/** Many users at once (the cron): one read of every balance. */
export async function brainModes(admin: SupabaseClient, userIds: string[]): Promise<Map<string, BrainMode>> {
  const out = new Map<string, BrainMode>();
  if (!userIds.length) return out;
  const { data, error } = await admin.from("profiles").select("id, credit_balance").in("id", userIds);
  if (error) throw new Error(`profiles: ${error.message}`);
  const balance = new Map(((data ?? []) as { id: string; credit_balance: number }[]).map((p) => [p.id, Number(p.credit_balance)]));
  const up = providersUp();
  const forced = forcedClaude();
  for (const id of userIds) out.set(id, decideBrain({ credits: balance.get(id) ?? 0, providersUp: up, forced }));
  return out;
}
