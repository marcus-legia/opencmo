import type { Metadata } from "next";
import Link from "next/link";

import { SettingsView } from "@/components/clipping/web/SettingsView";
import { Panel } from "@/components/ui";
import { UI_V2 } from "@/lib/screens/flag";
import { SettingsScreen } from "@/components/screens/settings/SettingsScreen";
import { SettingsFrame } from "@/components/today/SettingsFrame";
import { mcpEndpoint } from "@/lib/cmo/connect";
import { editorLive } from "@/lib/editor-flag";
import { isPaidPlan } from "@/lib/pricing";
import { createServerClient } from "@/lib/supabase/server";
import { currentUser } from "@/lib/supabase/user";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  // MCP (API keys, Connected apps) is a paid-plan feature; the cards show the upgrade path instead.
  const supabase = await createServerClient();
  const user = await currentUser();
  // The owner pages answer only `app_owners`, which is not readable under RLS; `ops_is_owner` says yes or no for the caller.
  const [{ data: profile }, owner] = user
    ? await Promise.all([
        supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle(),
        supabase.rpc("ops_is_owner").then(({ data }) => data === true),
      ])
    : [{ data: null }, false];
  const paid = isPaidPlan((profile as { plan?: string } | null)?.plan);
  const ownerLinks = owner ? <OwnerLinks /> : null;
  if (UI_V2)
    return (
      <SettingsFrame current="accounts" keys={editorLive()}>
        <SettingsScreen mcpEndpoint={mcpEndpoint()} paid={paid} editor={editorLive()} />
        {ownerLinks}
      </SettingsFrame>
    );
  return (
    <>
      <SettingsView mcpEndpoint={mcpEndpoint()} paid={paid} />
      {ownerLinks}
    </>
  );
}

function OwnerLinks() {
  return (
    <Panel id="settings-owner" title="Owner">
      <p className="v2-panel-body">
        <Link href="/app/settings/costs">Costs</Link> · <Link href="/app/settings/funnel">Funnel</Link> ·{" "}
        <Link href="/app/settings/failures">Failures</Link>
      </p>
    </Panel>
  );
}
