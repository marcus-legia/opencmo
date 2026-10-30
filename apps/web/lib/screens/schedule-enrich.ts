import "server-only";

/**
 * What a schedule card shows beyond its snapshot (P4 A3): the founder's timezone, the account's avatar, the video's
 * signed preview and TikTok's creator info (the privacy levels and toggles the account allows). None of it is part of
 * what the card approves, so it is read fresh on every load, under the founder's own session. A part that cannot be
 * read stays empty; the card still shows and still decides.
 */

import type { SupabaseClient } from "@/lib/api/handler";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import type { CreatorInfo } from "@/lib/departments/publish/types";

import type { ApprovalCard } from "./approval-card";
import { shortRenders, sign } from "./studio-sign";

/** Creator info is asked only for cards still waiting: a decided card shows what was approved. */
async function creatorInfo(accounts: Map<string, string>, ids: string[]): Promise<Map<string, CreatorInfo>> {
  const out = new Map<string, CreatorInfo>();
  if (!ids.length) return out;
  let adapter;
  try {
    adapter = publishAdapter();
  } catch {
    // Posting is not set up here (no fake, no Zernio): the card offers no TikTok fields and cannot be approved.
    return out;
  }
  await Promise.all(
    ids.map(async (id) => {
      const zernio = accounts.get(id);
      if (!zernio) return;
      try {
        out.set(id, await adapter.creatorInfo(zernio));
      } catch (err) {
        console.warn("[schedule] creator info not loaded", err instanceof Error ? err.message : err);
      }
    }),
  );
  return out;
}

type SlotRow = {
  id: string;
  status: string;
  error: { code?: string } | null;
  external_url: string | null;
  deliverable: { ref_kind: string; ref_id: string } | null;
};

/** What the card offers, from the slot: SQL keeps the reason's code (`missed`, `no_account`, a platform's refusal). */
function slotState(slot: SlotRow): Extract<ApprovalCard["body"], { kind: "schedule" }>["state"] {
  if (slot.error?.code === "missed" && slot.status === "proposed") return "missed";
  if (slot.status !== "failed") return "waiting";
  return slot.error?.code === "no_account" ? "no_account" : "failed";
}

export async function enrichScheduleCards(supabase: SupabaseClient, userId: string, cards: ApprovalCard[]): Promise<ApprovalCard[]> {
  const schedule = cards.filter((c) => c.body.kind === "schedule");
  if (!schedule.length) return cards;
  const bodies = schedule.map((c) => c.body as Extract<ApprovalCard["body"], { kind: "schedule" }>);
  const accountIds = [...new Set(bodies.flatMap((b) => (b.accountId ? [b.accountId] : [])))];
  const slotIds = bodies.map((b) => b.slotId);

  const [profile, accounts, slots] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
    accountIds.length
      ? supabase.from("social_accounts").select("id, avatar_url, zernio_account_id").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; avatar_url: string | null; zernio_account_id: string }[] }),
    supabase.from("schedule_slots").select("id, status, error, external_url, deliverable:deliverables(ref_kind, ref_id)").in("id", slotIds),
  ]);
  const timezone = (profile.data as { timezone?: string } | null)?.timezone ?? "UTC";
  const accountRows = (accounts.data ?? []) as { id: string; avatar_url: string | null; zernio_account_id: string }[];
  const avatar = new Map(accountRows.map((a) => [a.id, a.avatar_url]));
  const slotRows = (slots.data ?? []) as unknown as SlotRow[];
  const slotOf = new Map(slotRows.map((s) => [s.id, s]));
  const clipOf = new Map(
    slotRows.flatMap((s) =>
      s.deliverable?.ref_kind === "clip" ? [[s.id, s.deliverable.ref_id] as const] : [],
    ),
  );

  const renders = await shortRenders(supabase, [...new Set(clipOf.values())]);
  const signed = await sign(supabase, "exports", [...renders.values()]);
  const tiktokIds = schedule.flatMap((c) => {
    const b = c.body as Extract<ApprovalCard["body"], { kind: "schedule" }>;
    return c.status === "waiting" && b.where.platform === "tiktok" && b.mode === "publish" && b.accountId ? [b.accountId] : [];
  });
  const info = await creatorInfo(new Map(accountRows.map((a) => [a.id, a.zernio_account_id])), [...new Set(tiktokIds)]);

  return cards.map((card) => {
    if (card.body.kind !== "schedule") return card;
    const b = card.body;
    const clip = clipOf.get(b.slotId);
    const render = clip ? renders.get(clip) : undefined;
    const creator = b.accountId ? info.get(b.accountId) : undefined;
    const slot = slotOf.get(b.slotId);
    return {
      ...card,
      body: {
        ...b,
        timezone,
        avatarUrl: (b.accountId ? avatar.get(b.accountId) : null) ?? null,
        preview: { ...b.preview, videoUrl: render ? signed.get(render) ?? null : null },
        state: slot ? slotState(slot) : b.state,
        publishedUrl: slot?.status === "published" && slot.external_url?.startsWith("https://") ? slot.external_url : null,
        tiktok:
          creator && creator.privacyLevels.length > 0
            ? {
                privacyLevels: creator.privacyLevels,
                commentDisabled: !creator.commentEnabled,
                duetDisabled: creator.duetEnabled === false,
                stitchDisabled: creator.stitchEnabled === false,
              }
            : null,
      },
    };
  });
}
