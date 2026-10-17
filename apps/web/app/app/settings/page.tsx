import { SettingsView } from "@/components/clipping/web/SettingsView";
import { mcpEndpoint } from "@/lib/cmo/connect";
import { isPaidPlan } from "@/lib/pricing";
import { createServerClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  // MCP (API keys, Connected apps) is a paid-plan feature; the cards show the upgrade path instead.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle() : { data: null };
  return <SettingsView mcpEndpoint={mcpEndpoint()} paid={isPaidPlan((profile as { plan?: string } | null)?.plan)} />;
}
