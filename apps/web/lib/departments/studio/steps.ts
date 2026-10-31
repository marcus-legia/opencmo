/**
 * A priced Studio step stored behind an approval card (P2 F3): `studio_steps` through A's
 * `studio_step_raise`, which raises the card in the same transaction and holds no credits. The card
 * fields are the ones `approval_snapshot` reads (`A.md` notes): storage paths, never signed URLs.
 */

import { rpcOrThrow } from "@/lib/api/handler";
import type { SheetTile } from "@/lib/agent/long-take";
import type { LongTakePlan } from "@opencmo/editor-core";

import type { StudioContext, StudioPlan } from "./types";

type Priced = Extract<StudioPlan, { kind: "priced" }>;

/** Card 1 for `create_video`; card 2 (and a redone keyframe) for `animate_video` / `redo_keyframe`. */
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
  const tiles: { index: number; words: string; path: string | null; garbled: boolean; credits: number }[] = ((plan.sheet as { tiles?: SheetTile[] } | undefined)?.tiles ?? []).map((tile) => ({
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

export async function raiseStep(ctx: StudioContext, plan: Priced, options: { redoOf?: string } = {}): Promise<{ stepId: string }> {
  const { kind, card } = stepCard(plan);
  if (kind === "price" && card.seconds == null && options.redoOf) card.seconds = await replacedSeconds(ctx, options.redoOf);
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
