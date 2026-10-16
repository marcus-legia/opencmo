/**
 * The account group (B6): the founder's credits and who thinks for them right now, plus the
 * top-up message media tools return instead of failing when the balance is short.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { SITE_URL } from "@/lib/site";

import { brainMode, type BrainMode } from "../brain";

import { fail, ok, type CmoMcpTool } from "./contract";

const BILLING_URL = `${SITE_URL}/app/billing`;

async function balance(supabase: SupabaseClient, userId: string): Promise<{ credits: number; plan: string } | null> {
  const { data, error } = await supabase.from("profiles").select("credit_balance, plan").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  const row = data as { credit_balance: number | null; plan: string | null };
  return { credits: Number(row.credit_balance ?? 0), plan: row.plan ?? "free" };
}

/**
 * For media tools (fal, ElevenLabs, render): null when the founder can pay `needed` credits,
 * otherwise the sentence to return as the tool's error. Thinking never needs credits over MCP.
 */
export async function mediaCreditsShort(supabase: SupabaseClient, userId: string, needed: number): Promise<string | null> {
  const account = await balance(supabase, userId);
  const credits = account?.credits ?? 0;
  if (credits >= needed) return null;
  return `Top up credits to create media: this needs ${needed} credits and ${credits} are left. The founder can top up at ${BILLING_URL}. Planning and writing in Claude need no credits.`;
}

export function modeText(mode: BrainMode): string {
  switch (mode.reason) {
    case "ok":
      return `OpenCMO's own AI is thinking for this account (${mode.credits} credits). Scheduled CMO work runs by itself and lands in Approvals. You can still do any task here; thinking in Claude costs no credits.`;
    case "credits":
      return `The account has ${mode.credits} credits, less than one Assistant turn, so you are the brain: scheduled CMO work waits in the inbox (list_inbox). Thinking here is free; only media (images, video, voice, renders) needs credits.`;
    case "llm_down":
      return "OpenCMO's own AI cannot answer right now, so you are the brain: scheduled CMO work waits in the inbox (list_inbox). Only media (images, video, voice, renders) needs credits.";
    case "forced":
      return "This server runs every account through Claude (development setting): scheduled CMO work waits in the inbox (list_inbox).";
  }
}

const empty = z.object({});

export const ACCOUNT_TOOLS: CmoMcpTool[] = [
  {
    name: "get_credits",
    title: "Get credits",
    description: "The founder's credit balance and plan. Media (images, video, voice, renders) costs credits; thinking in Claude does not.",
    inputSchema: empty,
    outputSchema: z.object({ credits: z.number(), plan: z.string(), billing_url: z.string() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(_input, { supabase, userId }) {
      const account = await balance(supabase, userId);
      if (!account) return fail("Could not read the credit balance. Try again in a minute.");
      return ok(`${account.credits} credits (${account.plan} plan). Top up: ${BILLING_URL}`, { ...account, billing_url: BILLING_URL });
    },
  },
  {
    name: "get_mode",
    title: "Who is thinking",
    description: "Whether OpenCMO's own AI or you (the founder's Claude) does the CMO thinking right now, and why. When it is you, scheduled work waits in the inbox.",
    inputSchema: empty,
    outputSchema: z.object({ brain: z.enum(["opencmo", "claude"]), reason: z.string(), credits: z.number() }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(_input, { supabase, userId }) {
      try {
        const mode = await brainMode(supabase, userId);
        return ok(modeText(mode), { ...mode });
      } catch {
        return fail("Could not read the account. Try again in a minute.");
      }
    },
  },
];
