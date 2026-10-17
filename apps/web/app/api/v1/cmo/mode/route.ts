import { withApi } from "@/lib/api/handler";
import { brainMode } from "@/lib/cmo/brain";
import { mcpEndpoint } from "@/lib/cmo/connect";

export const dynamic = "force-dynamic";

/**
 * Who thinks for the founder right now, and what waits in their Claude inbox. The Assistant panel
 * and the CMO chat show "Continue in Claude" when `brain` is `claude`.
 */
export const GET = withApi({}, async ({ supabase, user }) => {
  const mode = await brainMode(supabase, user.id);
  const { data } = await supabase.rpc("inbox_list");
  const inbox = ((data ?? []) as { status: string }[]).filter((item) => item.status === "open" || item.status === "claimed").length;
  return { ...mode, inbox, mcp_url: mcpEndpoint() };
});
