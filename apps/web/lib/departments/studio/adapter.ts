/**
 * The Studio adapter (P2 B1): `plan` and `decide`, extracted from MCP's studio group so the brain, MCP
 * and the founder's buttons run a priced Studio step the same way. `plan` prices it in the Assistant's
 * clip scope (`scope.plan`: model, seed, price, storyboard; nothing spent); `decide` runs it there
 * (`scope.decide`) once a card or a signed confirm code approves it.
 */

import { randomUUID } from "node:crypto";

import { ApiError } from "@/lib/api/errors";
import { mediaCreditsShort } from "@/lib/cmo/mcp/account";

import { studioSession, type SessionOptions } from "./session";
import { mayCall, type PreparedStep, type StepRef, type StudioAction, type StudioAdapter, type StudioContext, type StudioDecision, type StudioEntry, type StudioPlan } from "./types";

export class StudioAccessError extends Error {}

function allow(ctx: StudioContext, entry: StudioEntry) {
  if (!mayCall(ctx.caller, entry)) throw new StudioAccessError(`Studio ${entry} is not open to the ${ctx.caller}.`);
}

/** The reason a plan was refused, without the JSON wrapping the model reads. */
export function problem(content: string): string {
  try {
    const value = JSON.parse(content) as { INVALID_INPUT?: unknown; error?: unknown };
    return String(value.INVALID_INPUT ?? value.error ?? content);
  } catch {
    return content;
  }
}

/** A stored step under RLS: only the founder's own row, only while a decision can still run it. */
async function storedStep(ctx: StudioContext, stepId: string): Promise<PreparedStep> {
  const { data, error } = await ctx.supabase.from("studio_steps").select("clip_id, tool, input, status").eq("id", stepId).maybeSingle();
  if (error) throw new Error(`studio_steps read: ${error.message}`);
  const row = data as { clip_id: string; tool: string; input: unknown; status: string } | null;
  if (!row) throw new ApiError(404, "This step no longer exists.");
  if (!["waiting", "approved"].includes(row.status)) throw new ApiError(409, "This step was already decided.");
  return { clipId: row.clip_id, tool: row.tool, input: row.input };
}

export function studio(ctx: StudioContext, options: SessionOptions = {}): StudioAdapter {
  const session = (clipId: string) => studioSession(ctx.supabase, ctx.caller, clipId, options);

  async function plan(clipId: string, tool: string, input: unknown): Promise<StudioPlan> {
    allow(ctx, "plan");
    const { scope } = await session(clipId);
    const planned = await scope.plan({ id: randomUUID(), name: tool, input });
    if (planned.kind === "invalid") return { kind: "invalid", message: problem(planned.content) };
    if (planned.kind !== "approval") return { kind: "invalid", message: "This tool could not be priced. Please try again." };
    const card = planned.card as { changes?: string[]; credits?: number; storyboard?: unknown; sheet?: unknown };
    const credits = card.credits ?? 0;
    // Short of credits: say how to top up now, not after the founder agreed to a price they cannot pay.
    const short = credits ? await mediaCreditsShort(ctx.supabase, ctx.userId, credits) : null;
    if (short) return { kind: "short", message: short, credits };
    return {
      kind: "priced",
      credits,
      lines: card.changes ?? [],
      ...(card.storyboard ? { storyboard: card.storyboard } : {}),
      ...(card.sheet ? { sheet: card.sheet } : {}),
      prepared: { clipId, tool, input: planned.input },
    };
  }

  async function decide(step: StepRef, action: StudioAction): Promise<StudioDecision> {
    allow(ctx, "decide");
    const prepared = "prepared" in step ? step.prepared : await storedStep(ctx, step.stepId);
    if (action.kind === "redo" && prepared.tool !== "animate_video") throw new ApiError(400, "Only the contact sheet can redo one keyframe.");
    const { scope } = await session(prepared.clipId);
    const approved = await scope.decide(
      { id: randomUUID(), name: prepared.tool, input: {} },
      prepared.input,
      action.kind === "approve",
      action.kind === "redo" ? { index: action.index } : undefined,
    );
    const generationId = typeof approved.extra.generation_id === "string" ? approved.extra.generation_id : undefined;
    const view = approved.extra.view as { exports?: Record<string, unknown>[] } | undefined;
    return {
      outcome: approved.outcome,
      wrote: approved.wrote,
      ...(generationId ? { generationId } : {}),
      ...(view?.exports ? { exports: view.exports } : {}),
    };
  }

  const later = (entry: StudioEntry) => async (): Promise<never> => {
    allow(ctx, entry);
    throw new Error(`Studio ${entry} is not built yet.`);
  };

  return { plan, decide, buildVideo: later("buildVideo"), cutShorts: later("cutShorts"), markFinished: later("markFinished"), renderShort: later("renderShort") };
}
