import { withApi } from "@/lib/api/handler";
import { autopilotLine, autopilotSoon } from "@/lib/notify/autopilot";

export const dynamic = "force-dynamic";

/**
 * What the service worker shows for a push (pushes carry no payload, `public/sw.js`): every autopilot post of the
 * founder's due within two hours, each with its line in their time zone. The worker shows each under its own tag and
 * the waiting count beside them. Read under the founder's session.
 */
export const GET = withApi({}, async ({ supabase, user }) => {
  const soon = await autopilotSoon(supabase);
  if (!soon.length) return { autopilot: [] };
  const { data } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle<{ timezone: string | null }>();
  const zone = data?.timezone ?? "UTC";
  return { autopilot: soon.map((s) => ({ approvalId: s.approvalId, line: autopilotLine(s, zone) })) };
});
