/**
 * `edit_video`: change the look of a part of the user's own video with words ("make it night",
 * "turn the room into a studio"). One generation on one approval card, placed by one `edit_video`
 * op over the speaker, so Approve and Undo are one step each.
 */

import { randomInt } from "node:crypto";

import { z } from "zod";

import { editSeconds, planVideoEdit, type EditVideo, type OpContext } from "@opencmo/editor-core";
import { priceOf, type AiModel, type GenerationSpec } from "@opencmo/editor-core/generate";
import type { ClipDocument } from "@opencmo/clip-doc";

import { availableModels } from "@/lib/generate/models";

import type { PreparedGeneration } from "./generate-tool";
import { sanitize, type ToolSpec } from "./tools";

export const editInput = z.object({
  start: z.number().finite().min(0).describe("Clip seconds where the edit starts."),
  end: z.number().finite().min(0).describe("Clip seconds where it ends: 3 to 10 s after start, inside one shot (no cut)."),
  prompt: z
    .string()
    .trim()
    .min(3)
    .max(800)
    .describe("What to change in the picture (light, setting, style, weather), not the whole scene again. The motion and camera stay. No real people, no logos."),
});

const editModel = (): AiModel | undefined => availableModels().find((model) => model.limits.clipVideo);

/** Tool only exists when this server has an edit model that may read the clip's own video. */
export function editToolSpec(): ToolSpec | null {
  const model = editModel();
  if (!model) return null;
  const seconds = editSeconds(model.id);
  return {
    name: "edit_video",
    description:
      `Change the look of the user's own video with words for one range of the clip (${Math.min(...seconds)}-${Math.max(...seconds)} s, inside one shot): light, setting, style or weather; the speaker's motion and the camera stay, the original sound keeps playing. The edited range plays over the original. It costs credits per second, so the user approves the price first. Use it when the user asks to change how a part of their video looks; for a new background behind them use replace_background. After it is placed, capture a frame in the middle of the range when the media is ready.`,
    schema: sanitize(z.toJSONSchema(editInput, { io: "input" })).schema as Record<string, unknown>,
    strict: true,
    approval: true,
  };
}

const credits = (value: number) => `${value} ${value === 1 ? "credit" : "credits"}`;

/** The generation and the op, priced and checked against the current document. */
export function prepareEdit(input: unknown, document: ClipDocument, ctx: Pick<OpContext, "media">): PreparedGeneration | string {
  const parsed = editInput.safeParse(input);
  if (!parsed.success) return `${parsed.error.issues[0]?.path.join(".") ?? ""}: ${parsed.error.issues[0]?.message ?? "Invalid input."}`;
  const request = parsed.data;
  const model = editModel();
  if (!model) return "Editing the video with AI is not available.";
  const op: EditVideo = { op: "edit_video", start: request.start, end: request.end, model: model.id, prompt: request.prompt, seed: randomInt(0, 2_147_483_647) };
  let plan: ReturnType<typeof planVideoEdit>;
  try {
    plan = planVideoEdit(document, op, ctx);
  } catch (err) {
    return (err as Error).message;
  }
  const { generate: _kind, model: _model, ...spec } = plan.declaration as Record<string, unknown>;
  const total = priceOf(model, spec as GenerationSpec);
  return {
    model,
    spec: spec as GenerationSpec,
    op: op as never,
    credits: total,
    lines: [`Edit your video from ${request.start}s to ${request.end}s (${model.name}) · ${credits(total)}`, `Change: ${request.prompt}`],
  };
}
