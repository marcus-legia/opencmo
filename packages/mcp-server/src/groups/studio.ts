/**
 * Studio: every clip tool of the editor Assistant, with `clip_id` (A4, A5).
 *
 * One codebase: each call builds the Assistant's own clip scope (`clipScopeWith`) and runs the tool
 * through it, so a cut, a caption, a generation or an explainer goes through exactly the code the
 * in-app Assistant uses — editor-core ops via `workspace.apply`, the same CAS and checks, a
 * checkpoint "MCP" in Version history for every write.
 *
 * What the Assistant puts on an approval card is a price step here: `scope.plan` prepares it (model,
 * seed, price, storyboard; nothing spent), the server signs it, and only the confirmed call runs
 * `scope.decide`. Not offered: tools that need the editor open in a browser (frame capture,
 * waveforms), `ask_user` and `update_plan` (Claude asks and plans itself) and `undo`
 * (no request to undo; Version history restores any checkpoint).
 *
 * The thinking is the client's: `create_video` and `plan_video` take the client's finished plan
 * (our director and motion team never run over MCP, there are no agent credits to pay for them),
 * and the code Reviewer still checks it.
 */

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { clipContext } from "@/lib/api/clips";
import { directorSchema, DIRECTOR } from "@/lib/agent/create-video";
import { CAPTION_TOOLS } from "@/lib/agent/captions-tool";
import { clipScopeWith, clipToolSpecs, type ClipHost, type Scope } from "@/lib/agent/scope";
import { mediaCreditsShort } from "@/lib/cmo/mcp/account";
import { isWriteTool, sanitize, type ToolOutcome, type ToolSpec } from "@/lib/agent/tools";
import { introSpecSchema } from "@opencmo/editor-core";
import { ensureBlankProject, ensureEditorProject } from "@/lib/editor/project";
import { loadCatalog } from "@/lib/generate/models";

import { PREVIEW_SECONDS, read as readCode, sha256, sign } from "../confirm";
import { errorResult, registerGroup, type McpResult, type McpTool, type McpToolContext } from "../registry";

/** In-app only: they need the user at the screen, or a turn to belong to. */
const SKIP = new Set(["update_plan", "ask_user", "undo"]);
/** Need no clip: registered without clip_id by the guides and explainer groups. */
export const CLIP_FREE = new Set(["read_guide", "read_skill", "save_skill", "find_icons", "list_motion_styles", "get_motion_style", "list_motion_templates", "get_motion_template"]);

/** Tools whose in-app version waits on an approval card: here, price → confirm. */
export const PRICED = new Set([
  "generate_media",
  "add_voiceover",
  "replace_background",
  "create_video",
  "animate_video",
  "redo_keyframe",
  "edit_video",
  "add_explainer",
  "plan_video",
  "request_export",
  ...CAPTION_TOOLS,
]);

/** MCP names where the Assistant's name reads oddly outside the editor chat. */
const RENAME: Record<string, string> = { request_export: "export_clip" };

/** Free previews cost us a render each: per user per hour (A9, `rate_limit_hit` bucket `mcp_preview`). */
export const PREVIEW_LIMIT = 60;

/** Writes that only remove or replace (MCP `destructiveHint`); every write is still a checkpoint. */
const DESTRUCTIVE = /^(delete_|remove_|ripple_delete|restore_all|ungroup_|merge_lines|split_|trim_|slip_|replace_)/;

const clipId = z.string().uuid().describe("The clip to work on (from list_clips).");

function withClip(schema: Record<string, unknown>, extra: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> {
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  return {
    ...schema,
    type: "object",
    properties: { clip_id: { type: "string", description: "The clip to work on (from list_clips)." }, ...properties, ...extra },
    required: ["clip_id", ...((schema.required as string[] | undefined) ?? []).filter((key) => key !== "clip_id"), ...required],
  };
}

const jsonOf = (schema: z.ZodType) => sanitize(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })).schema as Record<string, unknown>;

const title = (name: string) => name.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());

/** The extra input each tool takes over MCP, and the words that explain it. */
function mcpShape(spec: ToolSpec): { schema: Record<string, unknown>; description: string } {
  const notes: string[] = [];
  let schema = withClip(spec.schema);
  if (spec.name === "create_video") {
    schema = withClip(
      spec.schema,
      { plan: { ...jsonOf(directorSchema), description: "Your finished plan: title, script, style, music, and shots with words, keyframe, motion and continues." } },
      ["plan"],
    );
    notes.push(
      `You are the director: send the whole plan in "plan". The server reviews it (lengths, the beats rejoining to the script, names and numbers kept in one beat, repeated keyframes) and tells you what to fix before pricing it. The price is the keyframes only; confirming makes them, and the result holds what animate_video needs. The director's rules:\n${DIRECTOR}`,
    );
  } else if (spec.name === "animate_video") {
    notes.push("Pass the plan, aspect, model and keyframes exactly as create_video's result returned them, once wait_for_media says the keyframes are done. The price is the exact video price; confirm only after the user agrees.");
  } else if (spec.name === "plan_video") {
    schema = withClip(spec.schema, { spec: { ...jsonOf(introSpecSchema), description: "Your finished intro plan." } }, ["spec"]);
    notes.push('You plan the intro: send the full IntroSpec in "spec" (read_guide "motion" first). The code Reviewer checks it and tells you what to fix; then the user approves the storyboard. No credits.');
  } else if (spec.name === "add_explainer") {
    schema = withClip(spec.schema, { preview_token: { type: "string", description: "The preview_token preview_explainer returned for this exact code." } }, ["preview_token"]);
    notes.push("Pass the preview_token from the preview of this exact code.");
  } else if (spec.name === "wait_for_media") {
    notes.push("Waits at most 50 seconds per call.");
  }
  const description = spec.description
    // In-app wording that has no meaning here.
    .replace(/The user approves on a card;?/g, "The user agrees to the price first;")
    .replace(/appear in the chat with a Download button/g, "can be downloaded with get_export");
  return { schema, description: [description, ...notes].join("\n\n") };
}

/** Text, images and errors of an Assistant tool outcome, as MCP content. */
export function fromOutcome(outcome: ToolOutcome, extra: Record<string, unknown> = {}): McpResult {
  let text = outcome.content;
  if (Object.keys(extra).length) {
    try {
      const value = JSON.parse(outcome.content) as unknown;
      text = JSON.stringify(value && typeof value === "object" && !Array.isArray(value) ? { ...value, ...extra } : { result: value, ...extra });
    } catch {
      text = JSON.stringify({ result: outcome.content, ...extra });
    }
  }
  return {
    content: [{ type: "text", text }, ...(outcome.images ?? []).map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }))],
    ...(outcome.ok ? {} : { isError: true }),
  };
}

const problem = (content: string) => {
  try {
    const value = JSON.parse(content) as { INVALID_INPUT?: unknown; error?: unknown };
    return String(value.INVALID_INPUT ?? value.error ?? content);
  } catch {
    return content;
  }
};

type Session = { scope: Scope; context: Awaited<ReturnType<typeof clipContext>> };

/** The Assistant's clip scope for one MCP call: checkpoint "MCP" on every write (as the Vercel route). */
async function session(ctx: McpToolContext, clip: string, previewed: () => Promise<string[]>): Promise<Session> {
  await loadCatalog(ctx.supabase);
  const context = await clipContext(ctx.supabase, clip);
  // The editor creates a clip's project the first time it opens it; over MCP nobody opens it, so the
  // first call does the same (both keep a project that already exists).
  if (context.clip.kind === "blank") await ensureBlankProject(ctx.supabase, context, clip);
  else await ensureEditorProject(ctx.supabase, context, clip);
  const host: ClipHost = {
    checkpoint: { take: () => ({ kind: "agent" as const, label: "MCP" }), mark: async () => undefined },
    // The plans come from the client, so the video team's models are never called over MCP.
    recordUsage: async (usage) => {
      console.warn("[mcp] unexpected model usage", usage.model);
    },
    previewed,
  };
  return { scope: await clipScopeWith(ctx.supabase, context, clip, host), context };
}

/** add_explainer takes code the client previewed: the preview_token proves it, signed for this user. */
function previewProof(ctx: McpToolContext, args: Record<string, unknown>) {
  return async () => {
    const token = typeof args.preview_token === "string" ? args.preview_token : "";
    const code = typeof args.code === "string" ? args.code : "";
    if (!token || !code) return [];
    try {
      return readCode(token, ctx.userId, "preview") === sha256(code) ? [code] : [];
    } catch {
      return [];
    }
  };
}

async function previewAllowed(ctx: McpToolContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc("rate_limit_hit", { p_bucket: "mcp_preview", p_limit: PREVIEW_LIMIT, p_window_seconds: 3600 });
  if (error) throw new Error(`rate_limit_hit mcp_preview: ${error.message}`);
  return data !== false;
}

const input = z.looseObject({ clip_id: clipId });

/**
 * What the server itself requires, beyond clip_id. The thinking is the client's: without its plan
 * these two would run OpenCMO's own director or motion team, which no agent credits pay for here.
 */
const REQUIRED: Record<string, z.ZodType> = {
  // Checked by create_video itself, so a plan in an older format gets one message naming the fields.
  create_video: input.extend({ plan: z.custom<unknown>((value) => value !== undefined && value !== null, "Send your finished plan: title, script, style, music and shots.") }),
  plan_video: input.extend({ spec: introSpecSchema }),
};

function toMcp(spec: ToolSpec): McpTool {
  const name = RENAME[spec.name] ?? spec.name;
  const shape = mcpShape(spec);
  const priced = PRICED.has(spec.name);
  const writes = isWriteTool(spec.name) || spec.name === "apply_brand_kit" || priced;
  const call = (args: Record<string, unknown>) => {
    const { clip_id: _clip, preview_token: _token, ...rest } = args;
    return { id: randomUUID(), name: spec.name, input: spec.name === "wait_for_media" ? { ...rest, seconds: Math.min(Number(rest.seconds ?? 45), 50) } : rest };
  };
  const tool: McpTool = {
    name,
    title: title(name),
    description: shape.description,
    inputSchema: REQUIRED[spec.name] ?? input,
    inputJsonSchema: shape.schema,
    annotations: {
      readOnlyHint: !writes && !["save_skill", "send_feedback", "manage_exports"].includes(spec.name),
      destructiveHint: DESTRUCTIVE.test(spec.name),
      idempotentHint: !writes,
      // Generations reach fal / ElevenLabs; everything else stays inside OpenCMO.
      openWorldHint: priced && spec.name !== "plan_video" && spec.name !== "request_export",
    },
    async run(args, ctx) {
      if (priced) {
        // Confirmed: `args` is the signed price step, never the client's input.
        const prepared = args as { clipId: string; input: unknown };
        const { scope } = await session(ctx, prepared.clipId, async () => []);
        const approved = await scope.decide({ id: randomUUID(), name: spec.name, input: {} }, prepared.input, true);
        const generation = approved.extra.generation_id ? { generation_id: approved.extra.generation_id, next: "Poll get_generation with this id (or wait_for_media)." } : {};
        // The in-app note points at a Download button in the chat; here the link comes from get_export.
        const exports = approved.extra.view
          ? { ...(approved.extra.view as object), note: "The files are rendering.", next: "Poll get_export with each task_id for the download link." }
          : {};
        return fromOutcome(approved.outcome, { ...generation, ...exports });
      }
      const values = args as Record<string, unknown>;
      if (spec.name === "preview_explainer" && !(await previewAllowed(ctx))) {
        return errorResult(`You have used the ${PREVIEW_LIMIT} explainer previews of this hour. Wait a bit, or add the explainer from the last clean preview.`);
      }
      const { scope } = await session(ctx, String(values.clip_id), async () => []);
      const outcome = await scope.run(call(values));
      if (spec.name === "preview_explainer" && outcome.ok && typeof values.code === "string") {
        return fromOutcome(outcome, { preview_token: sign(ctx.userId, "preview", sha256(values.code), PREVIEW_SECONDS) });
      }
      return fromOutcome(outcome);
    },
  };
  if (priced) {
    tool.costsCredits = true;
    tool.price = async (args, ctx) => {
      const values = args as Record<string, unknown>;
      const clip = String(values.clip_id);
      const { scope } = await session(ctx, clip, previewProof(ctx, values));
      const plan = await scope.plan(call(values));
      if (plan.kind === "invalid") return problem(plan.content);
      if (plan.kind !== "approval") return "This tool could not be priced. Please try again.";
      const card = plan.card as { changes?: string[]; credits?: number; storyboard?: unknown };
      // Short of credits: say how to top up now, not after the user agreed to a price they cannot pay.
      const short = card.credits ? await mediaCreditsShort(ctx.supabase, ctx.userId, card.credits) : null;
      if (short) return short;
      return {
        credits: card.credits ?? 0,
        lines: card.changes ?? [],
        ...(card.storyboard ? { details: { storyboard: card.storyboard } } : {}),
        prepared: { clipId: clip, input: plan.input },
      };
    };
  }
  return tool;
}

registerGroup({
  async toolsFor(ctx) {
    // The model catalog decides which generation tools exist, as for the Assistant.
    await loadCatalog(ctx.supabase);
    return clipToolSpecs()
      .filter((spec) => !spec.browser && !spec.input && !SKIP.has(spec.name) && !CLIP_FREE.has(spec.name))
      .map(toMcp);
  },
});
