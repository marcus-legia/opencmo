/**
 * The founder's credits for the editor MCP: the `get_credits` tool, and the top-up sentence priced
 * tools return instead of failing when the balance is short.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { SITE_URL } from "@/lib/site";

export const BILLING_URL = `${SITE_URL}/app/billing`;

export async function balance(supabase: SupabaseClient, userId: string): Promise<{ credits: number; plan: string } | null> {
  const { data, error } = await supabase.from("profiles").select("credit_balance, plan").eq("id", userId).maybeSingle();
  if (error || !data) return null;
  const row = data as { credit_balance: number | null; plan: string | null };
  return { credits: Number(row.credit_balance ?? 0), plan: row.plan ?? "free" };
}

/**
 * For media tools (fal, ElevenLabs, render): null when the founder can pay `needed` credits,
 * otherwise the sentence to return as the tool's error.
 */
export async function mediaCreditsShort(supabase: SupabaseClient, userId: string, needed: number): Promise<string | null> {
  const account = await balance(supabase, userId);
  const credits = account?.credits ?? 0;
  if (credits >= needed) return null;
  return `Top up credits to create media: this needs ${needed} credits and ${credits} are left. The founder can top up at ${BILLING_URL}.`;
}
