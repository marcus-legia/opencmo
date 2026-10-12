/**
 * `replace_background`: the speaker stays, the room behind them changes. Two generations on one
 * approval card (the AI cut-out of the user's own video, and the new background) placed by one
 * `replace_background` op, so Approve and Undo are one step each.
 */

import { randomInt } from "node:crypto";

import { z } from "zod";

import { MAX_SWAP_SECONDS, planBackgroundSwap, type OpContext, type ReplaceBackground } from "@opencmo/editor-core";
import { priceOf, type AiModel, type GenerationSpec } from "@opencmo/editor-core/generate";
import type { ClipDocument } from "@opencmo/clip-doc";

import { availableModels } from "@/lib/generate/models";

import type { PreparedGeneration } from "./generate-tool";
import { sanitize, type ToolSpec } from "./tools";

export const backgroundInput = z.object({
  start: z.number().finite().min(0).describe("Clip seconds where the new background starts."),
  end: z.number().finite().min(0).describe(`Clip seconds where it ends; at most ${MAX_SWAP_SECONDS} s after start, inside one shot (no cut).`),
  background: z
    .string()
    .trim()
    .min(3)
    .max(800)
    .describe("The place behind the speaker, as a scene: setting, light, mood, style. No people, no text, no logos."),
  kind: z.enum(["image", "video"]).optional().describe('"image" (default): a still room, cheaper. "video": gentle movement, costs more.'),
});

const cutoutModel = (): AiModel | undefined => availableModels().find((model) => model.limits.removeBackground);
const backgroundModel = (kind: "image" | "video"): AiModel | undefined =>
  availableModels().find((model) => model.kind === kind && !model.limits.scene && !model.limits.sourceVideo);

/** Tool only exists when this server can cut out and make backgrounds. */
export function backgroundToolSpec(): ToolSpec | null {
  if (!cutoutModel() || !backgroundModel("image")) return null;
  return {
    name: "replace_background",
    description:
      `Replace the room behind the speaker with a new AI background for one range of the clip (up to ${MAX_SWAP_SECONDS} s, inside one shot), keeping the speaker: an AI cut-out of the user's own video goes on top of a new background. It costs credits per second, so the user approves the price first. Use it when the user asks to change, swap or remove their background. Describe a place without people, text or logos. After it is placed, capture a frame in the middle of the range when the media is ready.`,
    schema: sanitize(z.toJSONSchema(backgroundInput, { io: "input" })).schema as Record<string, unknown>,
    strict: true,
    approval: true,
  };
}

const credits = (value: number) => `${value} ${value === 1 ? "credit" : "credits"}`;

/** The two generations and the op, priced and checked against the current document. */
export function prepareBackground(input: unknown, document: ClipDocument, ctx: Pick<OpContext, "media">): PreparedGeneration | string {
  const parsed = backgroundInput.safeParse(input);
  if (!parsed.success) return `${parsed.error.issues[0]?.path.join(".") ?? ""}: ${parsed.error.issues[0]?.message ?? "Invalid input."}`;
  const request = parsed.data;
  const kind = request.kind ?? "image";
  const cutout = cutoutModel();
  const scenery = backgroundModel(kind);
  if (!cutout || !scenery) return "Replacing the background is not available.";
  const op: ReplaceBackground = {
    op: "replace_background",
    start: request.start,
    end: request.end,
    cutout: { model: cutout.id, seed: randomInt(0, 2_147_483_647) },
    background: { kind, model: scenery.id, prompt: request.background, seed: randomInt(0, 2_147_483_647) },
  };
  let plan: ReturnType<typeof planBackgroundSwap>;
  try {
    plan = planBackgroundSwap(document, op, ctx);
  } catch (err) {
    return (err as Error).message;
  }
  const specOf = (declaration: Record<string, unknown>): GenerationSpec => {
    const { generate: _kind, model: _model, ...spec } = declaration;
    return spec as GenerationSpec;
  };
  const cutoutSpec = specOf(plan.cutout as Record<string, unknown>);
  const backgroundSpec = specOf(plan.background as Record<string, unknown>);
  const cutoutCredits = priceOf(cutout, cutoutSpec);
  const backgroundCredits = priceOf(scenery, backgroundSpec);
  const total = cutoutCredits + backgroundCredits;
  return {
    model: cutout,
    spec: cutoutSpec,
    op: op as never,
    credits: total,
    extra: [{ model: scenery, spec: backgroundSpec }],
    lines: [
      `Replace the background from ${request.start}s to ${request.end}s · ${credits(total)}`,
      `Cut-out of you (${cutout.name}) · ${credits(cutoutCredits)}`,
      `New ${kind === "video" ? "moving " : ""}background (${scenery.name}) · ${credits(backgroundCredits)}`,
      `Background: ${request.background}`,
    ],
  };
}
