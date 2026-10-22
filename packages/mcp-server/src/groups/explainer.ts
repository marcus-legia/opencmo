/**
 * Explainer kit (A5): what Claude needs to write a storyboard and scene code before it touches a
 * clip — voices, looks, formats, limits, price, the icon and Lottie search. `preview_explainer`
 * and `add_explainer` are studio tools (they take clip_id: the clip's brand accent and frame).
 */

import { z } from "zod";

import { EXPLAINER_CODE_CHARS, getMotionTemplateInput, runMotionTemplateTool } from "@/lib/agent/explainer-tool";
import { iconsInput, lottiesInput, runTool } from "@/lib/agent/tools";
import type { AgentWorkspace } from "@/lib/agent/workspace";
import { availableModels, loadCatalog } from "@/lib/generate/models";
import {
  EXPLAINER_FORMATS,
  EXPLAINER_MAX_SECONDS,
  EXPLAINER_MIN_SECONDS,
  EXPLAINER_MODEL,
  EXPLAINER_PERSONALITIES,
  EXPLAINER_THEMES,
  LOTTIE_PACK,
  MOTION_CLIP_MODEL,
} from "@opencmo/editor-core";

import { errorResult, registerGroup } from "../registry";
import { fromOutcome, PREVIEW_LIMIT } from "./studio";

/** find_icons / find_lotties read no clip: a workspace that is never touched. */
const NO_CLIP = new Proxy({} as AgentWorkspace, {
  get() {
    throw new Error("This tool works without a clip.");
  },
});

const kitOutput = z.object({
  available: z.boolean(),
  voices: z.array(z.string()),
  themes: z.array(z.string()),
  personalities: z.array(z.string()),
  formats: z.array(z.string()),
  limits: z.record(z.string(), z.unknown()),
  price: z.string(),
  silent_clip: z.union([z.string(), z.record(z.string(), z.string())]),
  lotties: z.array(z.string()),
  read_first: z.array(z.string()),
});

registerGroup({
  tools: [
    {
      name: "get_explainer_kit",
      title: "Get the explainer kit",
      description:
        "Everything for writing an explainer before you pick a clip: narration voices, themes, personalities, formats, limits, the price rule, the built-in Lottie names, and which guides to read (the scene-code API is the resource opencmo://kit/explainer). Free.",
      inputSchema: z.object({}),
      outputSchema: kitOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      async run(_input, { supabase }) {
        await loadCatalog(supabase);
        const model = availableModels().find((item) => item.id === EXPLAINER_MODEL);
        const clip = availableModels().find((item) => item.id === MOTION_CLIP_MODEL);
        const price = model?.price;
        const result = {
          available: Boolean(model),
          voices: model?.limits.voices ?? [],
          themes: [...EXPLAINER_THEMES],
          personalities: [...EXPLAINER_PERSONALITIES],
          formats: Object.keys(EXPLAINER_FORMATS),
          limits: {
            beats: "3 to 16, about 4 s each",
            say: "6-20 words per beat",
            label: "at most 5 words per beat",
            seconds: `${EXPLAINER_MIN_SECONDS}-${EXPLAINER_MAX_SECONDS}, from the narration`,
            code_chars: EXPLAINER_CODE_CHARS,
            previews_per_hour: PREVIEW_LIMIT,
          },
          price: price
            ? `${price.credits} credit${price.credits === 1 ? "" : "s"} per started 10 s, plus ${price.voiceKchars ?? 0} per started 1,000 characters of narration. add_explainer quotes the exact price first.`
            : "Explainers are not available on this server.",
          silent_clip: clip
            ? {
                what: "silent: true on preview_explainer / add_explainer: a 3-30 s animation with no voice (an intro, a logo reveal, a product moment). list_motion_templates has finished ones to start from.",
                beats: "1 to 8, each with seconds (0.5-30), adding up to at most 30 s",
                seconds: "the beats' seconds, rounded up (3-30)",
                price: `${clip.price.credits} credit${clip.price.credits === 1 ? "" : "s"} per started 10 s, no voice.`,
              }
            : "Silent motion clips are not available on this server.",
          lotties: LOTTIE_PACK.map((entry) => entry.name),
          read_first: ['read_guide "explainer" (storyboard rules, the kit, the preview loop)', "find_icons and find_lotties for every noun of the narration"],
        };
        if (!model) return { ...errorResult("Explainers are not available on this server."), structuredContent: result };
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      },
    },
    {
      name: "list_motion_templates",
      title: "List motion templates",
      description:
        "Finished silent motion clips to start from (a brand reveal, a phone carousel of app screens, an analytics card): id, format, length and slots. Free, no clip needed.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (input) => fromOutcome(runMotionTemplateTool("list_motion_templates", input)),
    },
    {
      name: "get_motion_template",
      title: "Get a motion template",
      description:
        "One motion template: scene code with SLOTS to edit, its direction (a valid motion spec), beats with seconds and format. Keep the motion, change the slots, preview with preview_explainer, then add it. Free, no clip needed.",
      inputSchema: getMotionTemplateInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (input) => fromOutcome(runMotionTemplateTool("get_motion_template", input)),
    },
    {
      name: "find_icons",
      title: "Find icons",
      description: "Search the icon library (about 1,850 Lucide line icons: people, science, health, money, tech, sport, emotions…) by meaning. Returns names for <Icon name> in explainer code and for add_icon.",
      inputSchema: iconsInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (input) => fromOutcome(await runTool("find_icons", input, { workspace: NO_CLIP })),
    },
    {
      name: "find_lotties",
      title: "Find animations",
      description: "Search the built-in Lottie animations by meaning: moving stick people and motion effects (walk, run, cheer, rocket-launch, lightbulb-on, confetti…) and about 140 animated emoji (emoji/fire, emoji/thinking…). Returns names for <Lottie name> in explainer code and for add_lottie.",
      inputSchema: lottiesInput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      run: async (input) => fromOutcome(await runTool("find_lotties", input, { workspace: NO_CLIP })),
    },
  ],
});
