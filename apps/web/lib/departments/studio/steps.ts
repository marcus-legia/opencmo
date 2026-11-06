/**
 * A priced Studio step stored behind an approval card (P2 F3): `studio_steps` through A's
 * `studio_step_raise`, which raises the card in the same transaction and holds no credits. The card
 * fields are the ones `approval_snapshot` reads (`A.md` notes): storage paths, never signed URLs.
 */

import { rpcOrThrow } from "@/lib/api/handler";
import type { LongTakePlan } from "@opencmo/editor-core";

import type { StudioContext, StudioPlan } from "./types";

type Priced = Extract<StudioPlan, { kind: "priced" }>;

/**
 * The card for `create_video` (the whole video, one approval), or the price card of a redone keyframe
 * (`redo_keyframe`). A stored contact sheet from before /video ran in one go still reads its tiles.
 */
export function stepCard(plan: Priced): { kind: "script" | "price"; card: Record<string, unknown> } {
  const prepared = plan.prepared.input as { longTake?: { plan: LongTakePlan; aspect: string; seconds: number } };
  const title = plan.lines[0] ?? "";
  if (plan.prepared.tool === "create_video" && prepared.longTake) {
    const { plan: director, aspect, seconds } = prepared.longTake;
    return {
      kind: "script",
      card: {
        title: director.title || title,
        seconds,
        aspect,
        beats: director.shots.map((shot) => ({ words: shot.words, picture: shot.keyframe, motion: shot.motion || null })),
      },
    };
  }
  const tiles: { index: number; words: string; path: string | null; garbled: boolean; credits: number }[] = ((plan.sheet as { tiles?: { index: number; words: string; path: string; garbled: boolean; credits: number }[] } | undefined)?.tiles ?? []).map((tile) => ({
    index: tile.index,
    words: tile.words,
    path: tile.path,
    garbled: tile.garbled,
    credits: tile.credits,
  }));
  // Stage 2's op is the whole `create_video` placement: its shots and length are what the price buys.
  const op = (plan.prepared.input as { op?: { op?: string; shots?: unknown[]; seconds?: number; index?: number } }).op;
  const placed = op?.op === "create_video" ? op : null;
  // A redone keyframe: the one tile being made again, not yet a file.
  if (op?.op === "redo_keyframe" && typeof op.index === "number") tiles.push({ index: op.index, words: plan.lines[0] ?? "", path: null, garbled: false, credits: plan.credits });
  return {
    kind: "price",
    card: {
      title,
      what: plan.lines.slice(0, 2).join(" · ").slice(0, 200),
      seconds: placed?.seconds ?? null,
      wait_minutes: null,
      keyframes: tiles,
      shots: placed?.shots?.length ?? 0,
    },
  };
}

/** A redone keyframe's card shows the video's length, which only the step it replaces knows. */
async function replacedSeconds(ctx: StudioContext, stepId: string): Promise<number | null> {
  const { data, error } = await ctx.supabase.from("studio_steps").select("card").eq("id", stepId).maybeSingle<{ card: { seconds?: unknown } }>();
  if (error) throw new Error(`studio_steps read: ${error.message}`);
  const seconds = Number(data?.card?.seconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Credits this price goes past what the brain's order has left (cmo-review B3.4); 0 when it fits or has no order. */
async function overOrderBudget(ctx: StudioContext, credits: number): Promise<number> {
  if (!ctx.orderId || credits <= 0) return 0;
  const { data, error } = await ctx.supabase
    .from("work_orders")
    .select("budget_credits, spent_credits")
    .eq("id", ctx.orderId)
    .maybeSingle<{ budget_credits: number; spent_credits: number }>();
  if (error) throw new Error(`work_orders read: ${error.message}`);
  if (!data) return 0;
  return Math.max(0, credits - Math.max(0, data.budget_credits - data.spent_credits));
}

/** The price card's line, saying when approving it goes past the video's budget (the founder decides, knowing it). */
export function withBudgetNote(what: string, over: number): string {
  return over > 0 ? `${what ? `${what} · ` : ""}${over} credits past this video's budget`.slice(0, 200) : what;
}

export async function raiseStep(ctx: StudioContext, plan: Priced, options: { redoOf?: string } = {}): Promise<{ stepId: string }> {
  const { kind, card } = stepCard(plan);
  if (kind === "price" && card.seconds == null && options.redoOf) card.seconds = await replacedSeconds(ctx, options.redoOf);
  if (kind === "price") card.what = withBudgetNote(String(card.what ?? ""), await overOrderBudget(ctx, plan.credits));
  const row = await rpcOrThrow<{ id: string } | { id: string }[]>(ctx.supabase, "studio_step_raise", {
    p_clip_id: plan.prepared.clipId,
    p_tool: plan.prepared.tool,
    p_kind: kind,
    p_input: plan.prepared.input,
    p_card: card,
    p_price_credits: plan.credits,
    p_order_id: ctx.orderId ?? null,
    p_redo_of: options.redoOf ?? null,
  });
  const id = Array.isArray(row) ? row[0]?.id : row?.id;
  if (!id) throw new Error("studio_step_raise returned no step.");
  return { stepId: id };
}
