import { withApi } from "@/lib/api/handler";
import { brainMode } from "@/lib/cmo/brain";
import { mcpEndpoint } from "@/lib/cmo/connect";
import { isPaidPlan } from "@/lib/pricing";

export const dynamic = "force-dynamic";

/**
 * Who thinks for the founder right now, and what waits in their Claude inbox. The Assistant panel
 * and the CMO chat show "Continue in Claude" when `brain` is `claude`.
 */
export const GET = withApi({}, async ({ supabase, user }) => {
  const [mode, { data }, { data: profile }] = await Promise.all([
    brainMode(supabase, user.id),
    supabase.rpc("inbox_list"),
    supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle<{ plan: string }>(),
  ]);
  const inbox = ((data ?? []) as { status: string }[]).filter((item) => item.status === "open" || item.status === "claimed").length;
  // API keys are for paid plans (`create_api_key`), so "Continue in Claude" is a dead end without one.
  return { ...mode, inbox, mcp_url: mcpEndpoint(), can_connect: isPaidPlan(profile?.plan) };
});
