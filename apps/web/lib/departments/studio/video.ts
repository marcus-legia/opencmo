/**
 * `buildVideo` (P2 B2): the brain's video brief becomes a long take. The brief is mapped to
 * `create_video` input (the Director writes the script from it), a blank New edit is made for it,
 * and card 1 (storyboard + keyframe price) is stored as a `studio_steps` row instead of a chat card.
 * Later steps of the squad (card 2, a redone keyframe) are stored the same way: `plan` with `store`.
 */

import { rpcOrThrow } from "@/lib/api/handler";

import { VideoBriefSchema, type BuiltVideo, type StudioAdapter, type StudioContext, type VideoBrief } from "./types";

/** What `create_video` takes; its prompt is at most 2000 characters. */
export type CreateVideoRequest = { prompt: string; seconds: number; aspect: VideoBrief["aspect"]; voice?: string };

export type StrategyVoice = { voice?: string; avoid?: string[] };

const PROMPT_MAX = 2000;

/** The Director's prompt from the brief and the strategy's voice; facts only from the brief. */
export function briefRequest(brief: VideoBrief, strategy: StrategyVoice = {}): CreateVideoRequest {
  const lines = [
    `Goal: ${brief.objective}`,
    brief.angle && `Angle: ${brief.angle}`,
    brief.hooks.length && `Open with one of these hooks (the first is preferred): ${brief.hooks.map((hook) => `"${hook}"`).join("; ")}`,
    brief.keyPoints.length && `Facts to use (use no others): ${brief.keyPoints.join("; ")}`,
    brief.cta && `End with this call to action: ${brief.cta}`,
    strategy.voice?.trim() && `Brand voice: ${strategy.voice.trim()}`,
    strategy.avoid?.length && `Never say or imply: ${strategy.avoid.join("; ")}`,
  ].filter((line): line is string => Boolean(line));
  let prompt = lines.join("\n");
  if (prompt.length > PROMPT_MAX) prompt = `${prompt.slice(0, PROMPT_MAX - 1)}…`;
  return { prompt, seconds: brief.seconds, aspect: brief.aspect, ...(brief.voice ? { voice: brief.voice } : {}) };
}

async function strategyVoice(ctx: StudioContext): Promise<StrategyVoice> {
  const { data, error } = await ctx.supabase.from("marketing_documents_latest").select("body").eq("kind", "strategy").maybeSingle<{ body: { voice?: unknown; avoid?: unknown } }>();
  if (error) throw new Error(`marketing_documents_latest read: ${error.message}`);
  const body = data?.body ?? {};
  return {
    ...(typeof body.voice === "string" ? { voice: body.voice } : {}),
    ...(Array.isArray(body.avoid) ? { avoid: body.avoid.filter((item): item is string => typeof item === "string").slice(0, 10) } : {}),
  };
}

export async function buildVideo(ctx: StudioContext, adapter: Pick<StudioAdapter, "plan">, input: VideoBrief): Promise<BuiltVideo> {
  const brief = VideoBriefSchema.parse(input);
  const request = briefRequest(brief, await strategyVoice(ctx));
  const clipId = await rpcOrThrow<string>(ctx.supabase, "create_blank_edit", { p_name: brief.objective.slice(0, 60), p_aspect: brief.aspect });
  const plan = await adapter.plan(clipId, "create_video", request, { store: true });
  if (plan.kind !== "priced") return { kind: "invalid", message: plan.message };
  if (!plan.stepId) throw new Error("create_video was planned but not stored.");
  return { kind: "waiting", clipId, stepId: plan.stepId, credits: plan.credits };
}
