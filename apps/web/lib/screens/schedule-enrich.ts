import "server-only";

/**
 * What a schedule card shows beyond its snapshot (P4 A3): the founder's timezone, the account's avatar, the video's
 * signed preview and TikTok's creator info (the privacy levels and toggles the account allows). None of it is part of
 * what the card approves, so it is read fresh on every load, under the founder's own session. A part that cannot be
 * read stays empty; the card still shows and still decides.
 */

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@/lib/api/handler";
import { profileOf } from "@/lib/cmo/platforms";
import { publishAdapter } from "@/lib/departments/publish/adapter";
import type { CreatorInfo } from "@/lib/departments/publish/types";

import type { ApprovalCard } from "./approval-card";
import scheduleDefaults from "../../../../packages/contracts/schedule-defaults.json";

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

const LABEL: Record<string, string> = { x: "X", threads: "Threads", linkedin: "LinkedIn", tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };

/** "9 am", "4 pm", "12 pm". */
export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "am" : "pm"}`;
}

/**
 * The card's one-line reason for its time (P6 A2, F6): the founder's own best hour when the slot sits on one, the
 * common best times while the platform has too few posts, nothing when the time was moved off both (by the founder,
 * or by a gap or cap).
 */
export function bestTimeWhy(platform: string, localHour: number, localMinute: number, best: { hour: number }[], defaults: string[]): string | null {
  const label = LABEL[platform] ?? platform;
  if (best.length) {
    return localMinute === 0 && best.some((b) => b.hour === localHour) ? `Your posts on ${label} do best around ${hourLabel(localHour)}.` : null;
  }
  const at = `${String(localHour).padStart(2, "0")}:${String(localMinute).padStart(2, "0")}`;
  return defaults.includes(at) ? `A common best time on ${label}, until your own posts say better.` : null;
}

function localHourMinute(at: string, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  return { hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0), minute: Number(parts.find((p) => p.type === "minute")?.value ?? 0) };
}

/** What the card offers, from the slot: SQL keeps the reason's code (`missed`, `no_account`, a platform's refusal). */
function slotState(slot: SlotRow): Extract<ApprovalCard["body"], { kind: "schedule" }>["state"] {
  if (slot.error?.code === "missed" && slot.status === "proposed") return "missed";
  if (slot.status !== "failed") return "waiting";
  if (slot.error?.code === "unconfirmed") return "unconfirmed";
  return slot.error?.code === "no_account" ? "no_account" : "failed";
}

/** A post card's time (cmo-review-3 1.2) is shown and picked in the founder's timezone, like a schedule card's. */
function withPostTimezone(card: ApprovalCard, timezone: string): ApprovalCard {
  if (card.body.kind !== "post" || !card.body.proposed) return card;
  return { ...card, body: { ...card.body, proposed: { ...card.body.proposed, timezone } } };
}

/** A founder's script card gets the caption written with the script, from its order (read under RLS). */
async function withScriptCaptions(supabase: SupabaseClient, cards: ApprovalCard[]): Promise<ApprovalCard[]> {
  const ids = cards.flatMap((c) => (c.body.kind === "script" && c.body.forFounder ? [c.body.stepId] : []));
  if (!ids.length) return cards;
  const { data } = await supabase.from("work_orders").select("id, brief").in("id", ids);
  const captions = new Map(
    ((data ?? []) as { id: string; brief: { caption?: unknown } | null }[]).flatMap((row) =>
      typeof row.brief?.caption === "string" && row.brief.caption.trim() ? [[row.id, row.brief.caption.trim().slice(0, 2200)] as const] : [],
    ),
  );
  return cards.map((card) => {
    const caption = card.body.kind === "script" ? captions.get(card.body.stepId) : undefined;
    return caption && card.body.kind === "script" ? { ...card, body: { ...card.body, caption } } : card;
  });
}

const TEXT_TARGETS = ["x", "threads", "linkedin", "facebook"] as const;
type TextTarget = (typeof TEXT_TARGETS)[number];
const isTextTarget = (p: unknown): p is TextTarget => (TEXT_TARGETS as readonly unknown[]).includes(p);
const CORE = profileOf("core")!;

/** SQL `post_core_hash`: a rewrite is current only while the core text it was written from is unchanged. */
export const coreHash = (text: string): string => createHash("md5").update(text, "utf8").digest("hex");

/**
 * A post card's targets (the planner's, else its one platform) and each platform's current rewrite (daily core drafts
 * D3, D4). A post for two or more platforms is the core post, so the card shows the core profile's limit.
 */
export async function withPostTargets(supabase: SupabaseClient, cards: ApprovalCard[]): Promise<ApprovalCard[]> {
  const ids = cards.flatMap((c) => (c.body.kind === "post" && c.body.itemId ? [c.body.itemId] : []));
  if (!ids.length) return cards;
  const [items, variants] = await Promise.all([
    supabase.from("content_items").select("id, body").in("id", ids),
    supabase.from("post_variants").select("item_id, platform, text, source_hash").in("item_id", ids),
  ]);
  type ItemRow = { id: string; body: { targets?: unknown; text?: unknown; thread?: unknown } | null };
  type VariantRow = { item_id: string; platform: string; text: string; source_hash: string };
  const itemOf = new Map(((items.data ?? []) as ItemRow[]).map((r) => [r.id, r]));
  const variantRows = (variants.data ?? []) as VariantRow[];
  return cards.map((card) => {
    if (card.body.kind !== "post" || !card.body.itemId) return card;
    const itemId = card.body.itemId;
    const item = itemOf.get(itemId);
    const first = card.body.platforms[0];
    const listed = Array.isArray(item?.body?.targets) ? item.body.targets.filter(isTextTarget) : [];
    const targets: TextTarget[] = listed.length ? [...new Set(listed)] : first && isTextTarget(first.platform) ? [first.platform] : [];
    if (!targets.length) return card;
    const text = typeof item?.body?.text === "string" ? item.body.text : "";
    // As SQL `post_variant_text`: a thread is never rewritten, and a rewrite of older words is not shown.
    const current = (platform: string) =>
      item?.body?.thread ? null : variantRows.find((v) => v.item_id === itemId && v.platform === platform && v.source_hash === coreHash(text))?.text ?? null;
    const core = targets.length > 1 && first;
    return {
      ...card,
      body: {
        ...card.body,
        platforms: core ? [{ ...first, limit: CORE.limit, visibleBeforeMore: CORE.visibleBeforeMore }, ...card.body.platforms.slice(1)] : card.body.platforms,
        targets: targets.map((platform) => ({ platform, variant: current(platform) })),
      },
    };
  });
}

export async function enrichScheduleCards(supabase: SupabaseClient, userId: string, given: ApprovalCard[]): Promise<ApprovalCard[]> {
  const cards = await withPostTargets(supabase, await withScriptCaptions(supabase, given));
  const schedule = cards.filter((c) => c.body.kind === "schedule");
  if (!schedule.length) {
    if (!cards.some((c) => c.body.kind === "post" && c.body.proposed)) return cards;
    const { data } = await supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle();
    const timezone = (data as { timezone?: string } | null)?.timezone ?? "UTC";
    return cards.map((card) => withPostTimezone(card, timezone));
  }
  const bodies = schedule.map((c) => c.body as Extract<ApprovalCard["body"], { kind: "schedule" }>);
  const accountIds = [...new Set(bodies.flatMap((b) => (b.accountId ? [b.accountId] : [])))];
  const slotIds = bodies.map((b) => b.slotId);

  const [profile, accounts, slots, best] = await Promise.all([
    supabase.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
    accountIds.length
      ? supabase.from("social_accounts").select("id, avatar_url, zernio_account_id").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; avatar_url: string | null; zernio_account_id: string }[] }),
    supabase.from("schedule_slots").select("id, status, error, external_url, deliverable:deliverables(ref_kind, ref_id)").in("id", slotIds),
    supabase.from("best_slots").select("platform, hour"),
  ]);
  const bestRows = (best.data ?? []) as { platform: string; hour: number }[];
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
    if (card.body.kind !== "schedule") return withPostTimezone(card, timezone);
    const b = card.body;
    const clip = clipOf.get(b.slotId);
    const render = clip ? renders.get(clip) : undefined;
    const creator = b.accountId ? info.get(b.accountId) : undefined;
    const slot = slotOf.get(b.slotId);
    const local = localHourMinute(b.at, timezone);
    const defaults = (scheduleDefaults.platforms as Record<string, { times: string[] } | undefined>)[b.where.platform]?.times ?? [];
    return {
      ...card,
      body: {
        ...b,
        timezone,
        why: bestTimeWhy(b.where.platform, local.hour, local.minute, bestRows.filter((r) => r.platform === b.where.platform), defaults),
        avatarUrl: (b.accountId ? avatar.get(b.accountId) : null) ?? null,
        preview: { ...b.preview, videoUrl: render ? signed.get(render) ?? null : null },
        state: slot ? slotState(slot) : b.state,
        ...(slot?.status === "failed" && slot.error?.code === "too_long" && b.where.platform === "x" ? { canThread: true } : {}),
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
