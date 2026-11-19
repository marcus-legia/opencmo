import { withApi } from "@/lib/api/handler";
import { autopilotLine, autopilotSoon } from "@/lib/notify/autopilot";
import { strongLine, strongMatches } from "@/lib/notify/strong-match";

export const dynamic = "force-dynamic";

/**
 * What the service worker shows for a push (pushes carry no payload, `public/sw.js`): every autopilot post of the
 * founder's due within two hours, each with its line in their time zone. The worker shows each under its own tag and
 * the waiting count beside them. Read under the founder's session.
 */
export const GET = withApi({}, async ({ supabase, user }) => {
  // Wave 3 B8: the founder's strong matches in a fresh thread, from the last scan, read under their own session.
  const [soon, strong] = await Promise.all([autopilotSoon(supabase), strongMatches(supabase, { userId: user.id })]);
  const lines = strong.map((m) => ({ approvalId: m.approvalId, line: strongLine(m) }));
  if (!soon.length) return { autopilot: [], strong: lines };
  const { data } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle<{ timezone: string | null }>();
  const zone = data?.timezone ?? "UTC";
  return { autopilot: soon.map((s) => ({ approvalId: s.approvalId, line: autopilotLine(s, zone) })), strong: lines };
});
