import "server-only";

import type { SupabaseClient } from "@/lib/api/handler";

import type { ApprovalCard } from "./approval-card";
import { APPROVAL_COLUMNS, approvalToCard, type ApprovalRow } from "./cards";
import type { ScreenData, ScreenName } from "./registry";

export type LoadContext = { supabase: SupabaseClient; userId: string; params: URLSearchParams };

type Loader<N extends ScreenName> = (ctx: LoadContext) => Promise<Partial<ScreenData<N>>>;

/** The queue: waiting cards, oldest first. Kinds the app cannot show yet (A1, A3) are left out. */
async function waitingCards(supabase: SupabaseClient): Promise<ApprovalCard[]> {
  const { data, error } = await supabase
    .from("approvals")
    .select(APPROVAL_COLUMNS)
    .eq("status", "waiting")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`approvals: ${error.message}`);
  return ((data ?? []) as ApprovalRow[]).map((row) => approvalToCard(row)).filter((c): c is ApprovalCard => c !== null);
}

/**
 * Live readers, one per screen, under the founder's RLS session (no service role). A loader returns only the
 * fields it reads for real; `registry.ts` `live` must list them too before they replace sample data.
 * Brain plan W1-5 fills these as each backend phase lands.
 */
export const LOADERS: { [N in ScreenName]?: Loader<N> } = {
  dashboard: async ({ supabase }) => ({ queue: await waitingCards(supabase) }),
};
