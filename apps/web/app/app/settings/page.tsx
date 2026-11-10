import { SettingsView } from "@/components/clipping/web/SettingsView";
import { UI_V2 } from "@/lib/screens/flag";
import { SettingsScreen } from "@/components/screens/settings/SettingsScreen";
import { SettingsFrame } from "@/components/today/SettingsFrame";
import { mcpEndpoint } from "@/lib/cmo/connect";
import { isPaidPlan } from "@/lib/pricing";
import { createServerClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/user";

export default async function SettingsPage() {
  // MCP (API keys, Connected apps) is a paid-plan feature; the cards show the upgrade path instead.
  const supabase = await createServerClient();
  const user = await currentUser();
  const { data: profile } = user ? await supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle() : { data: null };
  const paid = isPaidPlan((profile as { plan?: string } | null)?.plan);
  if (UI_V2)
    return (
      <SettingsFrame current="general">
        <SettingsScreen mcpEndpoint={mcpEndpoint()} paid={paid} />
      </SettingsFrame>
    );
  return <SettingsView mcpEndpoint={mcpEndpoint()} paid={paid} />;
}
