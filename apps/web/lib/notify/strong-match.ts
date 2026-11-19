/**
 * The strong-match push (wave 3 B8; redesign plan, "Emails"): right after a scan, one push for a person who fits well
 * (a Strong match) in a thread under a day old, while an early reply still gets read. Once per card, logged as `push`
 * in `email_log` (`email_log_claim` keeps one push per card). The push has no payload (`push.ts`): the service worker
 * asks `/api/v1/notify/next` for the line, and a tap opens the card. Nothing is sent or posted for the founder.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { STRONG_MATCH } from "@/lib/cmo/match";
import { PLATFORM_LABEL, SALES_PLATFORMS, type SalesPlatform } from "@/lib/cmo/social/conversations";

import type { Vapid } from "./push";

/** A thread younger than this is fresh enough to push about. */
export const STRONG_PUSH_THREAD_HOURS = 24;
/** Cards raised this recently count as "right after a scan"; older ones the morning email covers. */
export const STRONG_PUSH_CARD_HOURS = 3;

export type StrongMatch = { approvalId: string; userId: string; platform: SalesPlatform; community: string };

/** "Strong match on r/freelance, posted in the last day. Reply while it is fresh." */
export function strongLine(m: Pick<StrongMatch, "platform" | "community">): string {
  const where = m.platform === "reddit" && m.community ? (m.community.startsWith("r/") ? m.community : `r/${m.community}`) : m.community || PLATFORM_LABEL[m.platform];
  return `Strong match on ${where.slice(0, 60)}, posted in the last day. Reply while it is fresh.`;
}

type CardRow = { id: string; user_id: string; ref_id: string; created_at: string };
type OppRow = { id: string; platform: string | null; community: string | null; score: number; posted_at: string | null };

/**
 * The waiting reply cards raised in the last few hours whose thread is a Strong match and under a day old. `userId`
 * narrows it to one founder (the service worker's read, under their session).
 */
export async function strongMatches(db: SupabaseClient, opts: { now?: Date; userId?: string } = {}): Promise<StrongMatch[]> {
  const now = opts.now ?? new Date();
  let q = db.from("approvals").select("id, user_id, ref_id, created_at").eq("status", "waiting").eq("kind", "reply").eq("ref_kind", "opportunity")
    .gte("created_at", new Date(now.getTime() - STRONG_PUSH_CARD_HOURS * 3_600_000).toISOString()).order("created_at").limit(200);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  const cards = await q;
  if (cards.error) throw new Error(`strong matches: ${cards.error.message}`);
  const rows = (cards.data ?? []) as CardRow[];
  if (!rows.length) return [];
  const opps = await db.from("opportunities").select("id, platform, community, score, posted_at").in("id", rows.map((r) => r.ref_id));
  if (opps.error) throw new Error(`strong matches: ${opps.error.message}`);
  const byId = new Map(((opps.data ?? []) as OppRow[]).map((o) => [o.id, o]));
  const fresh = now.getTime() - STRONG_PUSH_THREAD_HOURS * 3_600_000;
  return rows.flatMap((card) => {
    const o = byId.get(card.ref_id);
    if (!o || o.score < STRONG_MATCH || !o.posted_at || Date.parse(o.posted_at) < fresh) return [];
    const platform = (SALES_PLATFORMS as readonly string[]).includes(o.platform ?? "") ? (o.platform as SalesPlatform) : "reddit";
    return [{ approvalId: card.id, userId: card.user_id, platform, community: (o.community ?? "").trim() }];
  });
}

/**
 * Pushes each new strong match once to each of its founder's browsers: claimed first (`email_log_claim` kind `push`,
 * once per card while it waits), recorded after. A founder with push off or no browser gets nothing, and nothing is
 * logged. Returns the cards pushed.
 */
export async function pushStrongMatches(admin: SupabaseClient, vapid: Vapid, doFetch: typeof fetch = fetch, opts: { now?: Date; deadline?: number } = {}): Promise<number> {
  const matches = await strongMatches(admin, { now: opts.now });
  if (!matches.length) return 0;
  // `push.ts` is server-only; loaded here so the line and the read stay importable by pure checks.
  const { PUSH_BATCH, PUSH_HOSTS, sendPush } = await import("./push");
  const users = [...new Set(matches.map((m) => m.userId))];
  const [settings, subs] = await Promise.all([
    admin.from("notify_settings").select("user_id, push").in("user_id", users),
    admin.from("push_subscriptions").select("id, user_id, endpoint").in("user_id", users).order("failures"),
  ]);
  for (const r of [settings, subs]) if (r.error) throw new Error(`strong push: ${r.error.message}`);
  const pushOff = new Set(((settings.data ?? []) as { user_id: string; push: boolean }[]).filter((s) => !s.push).map((s) => s.user_id));
  const browsers = new Map<string, { id: string; endpoint: string }[]>();
  for (const s of (subs.data ?? []) as { id: string; user_id: string; endpoint: string }[]) {
    if (PUSH_HOSTS.test(s.endpoint)) browsers.set(s.user_id, [...(browsers.get(s.user_id) ?? []), s]);
  }
  let pushed = 0;
  for (const m of matches) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    const targets = browsers.get(m.userId) ?? [];
    if (pushOff.has(m.userId) || !targets.length) continue;
    try {
      const line = strongLine(m);
      const claimed = await admin.rpc("email_log_claim", { p_user: m.userId, p_kind: "push", p_approval_ids: [m.approvalId], p_subject: line, p_summary: { browsers: targets.length, reason: "strong_match" } });
      if (claimed.error) throw new Error(`email_log_claim: ${claimed.error.message}`);
      const log = ((claimed.data ?? []) as { log_id: string }[])[0];
      if (!log) continue;
      let accepted = 0;
      for (let i = 0; i < targets.length; i += PUSH_BATCH) {
        const statuses = await Promise.all(
          targets.slice(i, i + PUSH_BATCH).map(async (t) => {
            const status = await sendPush(vapid, t.endpoint, doFetch);
            const done = await admin.rpc("push_done", { p_subscription: t.id, p_status: status });
            if (done.error) console.warn("[notify] push_done", done.error.message);
            return status;
          }),
        );
        accepted += statuses.filter((st) => st >= 200 && st < 300).length;
      }
      await admin.rpc("email_log_done", { p_log: log.log_id, p_provider_id: accepted ? `push:${accepted}` : null, p_error: accepted ? null : "No browser accepted the push." });
      if (accepted) pushed += 1;
    } catch (err) {
      console.warn("[notify] strong-match push", m.approvalId, err instanceof Error ? err.message : err);
    }
  }
  return pushed;
}
