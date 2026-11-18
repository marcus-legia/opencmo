import { withApi } from "@/lib/api/handler";
import { autopilotLine, nextAutopilot } from "@/lib/notify/autopilot";

export const dynamic = "force-dynamic";

/**
 * What the service worker shows for a push (pushes carry no payload, `public/sw.js`): the founder's next autopilot post
 * within two hours, with its line in their time zone, or null. Read under the founder's session.
 */
export const GET = withApi({}, async ({ supabase, user }) => {
  const soon = await nextAutopilot(supabase, new Date());
  if (!soon) return { autopilot: null };
  const { data } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle<{ timezone: string | null }>();
  return { autopilot: { approvalId: soon.approvalId, line: autopilotLine(soon, data?.timezone ?? "UTC") } };
});
