/**
 * Phạm vi của một phiên Assistant: CLIP (editor) hay PROJECT (trang project).
 *
 * Vòng lặp không biết mình đang sửa một clip hay nhiều clip: phạm vi cho nó
 * bộ tool, system prompt, trạng thái để nối sau lượt ghi, và cách xử lý từng
 * tool call — chạy ngay, chờ trình duyệt (`capture_frames`), hay chờ người
 * duyệt (`apply_to_clips`).
 */

import { activeScene, frameAspect, MASTER_SRC, planStudio3d, planVoiceover, quoteRange, readBrand, speechSources, summarizeProject } from "@opencmo/editor-core";

import type { ClipContext } from "@/lib/api/clips";
import { ApiError } from "@/lib/api/errors";
import { rpcOrThrow, type SupabaseClient } from "@/lib/api/handler";
import { resolveMediaRefs } from "@/lib/generate/create";
import { previewMotion } from "@/lib/motion/preview";
import { moderateText, specText } from "@/lib/generate/moderation";
import { skillIndex as cmoSkillIndex } from "@/lib/cmo/skills";
import { ScBudget } from "@/lib/cmo/social/scrapecreators";
import type { LlmUsage } from "@/lib/cmo/jobs/llm";

import {
  applyInput,
  approvalCard,
  clipLabel,
  projectClips,
  runApply,
  runProjectRead,
  validateApply,
  PROJECT_TOOL_SPECS,
  type ApprovalCard,
  type ClipOutcome,
} from "./project-tools";
import { RESEARCH_CALLS_PER_TURN, RESEARCH_TOOLS, runResearchTool } from "./cmo-research";
import { CMO_TOOL_SPECS, cmoContext, cmoState, isCmoWrite, runCmoTool, type CmoTurn } from "./cmo-tools";
import { CMO_SYSTEM_PROMPT, PROJECT_SYSTEM_PROMPT, SYSTEM_PROMPT, projectStateBlock } from "./prompt";
import type { ToolCall } from "./providers/types";
import { runSkillTool, SKILL_SPECS, SKILL_TOOLS, skillIndex } from "./skills";
import { clipContextBlock, type ClipAbout } from "./clip-context";
import { dbWorkspace, type CheckpointHooks } from "./db-workspace";
import { libraryVideos, transcribing } from "./speech";
import {
  generateCard,
  generateToolSpec,
  prepareGeneration,
  prepareScene,
  prepareVoiceover,
  runGeneration,
  sceneToolSpec,
  voiceoverToolSpec,
  type PreparedGeneration,
} from "./generate-tool";
import { addExplainerInput, explainerCard, explainerText, explainerToolSpecs, prepareExplainer, runPreviewExplainer } from "./explainer-tool";
import { EXPORT_TOOL, exportCard, prepareExport, runExport, type PreparedExport } from "./export-tool";
import { runTurnTool, TURN_TOOL_SPECS, TURN_TOOLS } from "./turn-tools";
import { runWaitForMedia, WAIT_TOOL_SPEC } from "./wait-tool";
import { BRAND_TOOL_SPEC, CAPTION_TOOL_SPECS, CAPTION_TOOLS, captionsCard, prepareCaptions, runBrandTool, runCaptions, type PreparedCaptions } from "./captions-tool";
import { backgroundToolSpec, prepareBackground } from "./background-tool";
import { editToolSpec, prepareEdit } from "./edit-tool";
import { createVideoToolSpec, GENERATION_ACTIVE_LIMIT, prepareCreateVideo, videoPieces } from "./create-video";
import { turnStatus } from "./loop";
import { screenPieces } from "./screen-pieces";
import { PLAN_VIDEO_TOOL, prepareVideo, type PreparedVideo, type VideoCard } from "./video-team";
import { BROWSER_INPUTS, OWN_VIDEO_TOOLS, TOOL_SPECS, applyOpTool, askInput, isWriteTool, runCheck, runTool, type ToolOutcome, type ToolSpec } from "./tools";

/**
 * Kiểm lời của lượt sinh LÚC BÁO GIÁ: lời bị chặn thì không hiện thẻ duyệt cho
 * một thứ chắc chắn bị từ chối. `createGeneration` vẫn kiểm lại lúc chạy.
 */
async function screen(prepared: PreparedGeneration): Promise<Plan | null> {
  try {
    // Each model kind has its own policy, so each spec is judged on its own (variants share the prompt).
    await Promise.all(
      [{ model: prepared.model, spec: prepared.spec }, ...(prepared.extra ?? [])].map((item) =>
        moderateText(specText(item.spec).join("\n"), { kind: item.model.kind }),
      ),
    );
    return null;
  } catch (err) {
    const message = err instanceof ApiError ? err.message : "Could not check this request. Please try again.";
    return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: message }), summary: message };
  }
}

/** Tool tốn credit: đi qua thẻ duyệt giá rồi `runGeneration`. */
// add_3d_studio (4 khuôn) không còn cho agent: 3D của agent là code (add_3d_scene, spec code-scenes).
const PRICED_TOOLS = new Set(["generate_media", "add_3d_scene", "add_voiceover", "replace_background", "create_video", "edit_video", "add_explainer"]);

/** Tool call sau khi phạm vi xem xét nó. */
export type Plan =
  | { kind: "run" }
  | { kind: "browser"; input: unknown }
  | { kind: "approval"; input: unknown; card: ApprovalCard | ReturnType<typeof generateCard> | Awaited<ReturnType<typeof exportCard>> | VideoCard | ReturnType<typeof explainerCard> }
  | { kind: "input"; input: unknown; card: QuestionCard }
  | { kind: "invalid"; content: string; summary: string };

/** Thẻ câu hỏi của `ask_user`, vẽ ở panel như AskUserQuestion của DS. */
export type QuestionCard = { question: string; options: string[]; multi: boolean };

/** Kết quả của một tool đã được duyệt/từ chối. `extra` lưu vào `agent_tool_calls.result`. */
export type Approved = { outcome: ToolOutcome; extra: Record<string, unknown>; wrote: boolean };

export interface Scope {
  kind: "clip" | "project" | "cmo";
  tools: ToolSpec[];
  system: string;
  /** Khối `<project_state>` nối sau câu lệnh và sau lượt ghi. */
  state(): Promise<string>;
  /** Nội dung clip (`<clip_context>`) — chỉ gắn vào câu lệnh đầu mỗi yêu cầu. */
  context?(): Promise<string>;
  plan(call: ToolCall): Promise<Plan>;
  run(call: ToolCall): Promise<ToolOutcome>;
  decide(call: ToolCall, input: unknown, approved: boolean): Promise<Approved>;
  isWrite(name: string): boolean;
}

type Turn = { id: string; prompt: string };

/** Checkpoint `agent` cho lượt ghi ĐẦU TIÊN của lượt; lượt đánh dấu "có ghi". */
function checkpointing(supabase: SupabaseClient, turn: Turn, already: boolean) {
  let taken = already;
  return {
    label: `Before assistant: ${turn.prompt}`.slice(0, 200),
    taken: () => taken,
    mark: async (revisionId: string) => {
      if (taken) return;
      taken = true;
      await rpcOrThrow(supabase, "agent_set_checkpoint", { p_turn_id: turn.id, p_revision_id: revisionId });
    },
  };
}

/** The clip scope's tools. New tools go at the END: tool order is the start of the prompt cache. */
export function clipToolSpecs(options: { blank?: boolean } = {}): ToolSpec[] {
  const priced = [generateToolSpec(), sceneToolSpec(), voiceoverToolSpec()].filter((spec) => spec !== null);
  const background = backgroundToolSpec();
  const video = createVideoToolSpec();
  const editTool = editToolSpec();
  const base = options.blank ? TOOL_SPECS.filter((spec) => !OWN_VIDEO_TOOLS.has(spec.name)) : TOOL_SPECS;
  return [...base, ...priced, EXPORT_TOOL, ...SKILL_SPECS, ...TURN_TOOL_SPECS, ...CAPTION_TOOL_SPECS, BRAND_TOOL_SPEC, PLAN_VIDEO_TOOL, ...(background ? [background] : []), ...(video ? [video] : []), ...(editTool ? [editTool] : []), WAIT_TOOL_SPEC, ...explainerToolSpecs()];
}

/**
 * What a clip session needs from whoever drives it. The Assistant ties all of it to its turn
 * (`agent_turns`); the MCP server has no turn, so it brings its own (`packages/mcp-server`).
 */
export type ClipHost = {
  /** The checkpoint taken before the first write of the request, and where it is recorded. */
  checkpoint: CheckpointHooks;
  /** Charges the model calls of the video team (plan_video, create_video) to the request. */
  recordUsage: (usage: LlmUsage) => Promise<void>;
  /** Scene code previewed in this request: add_explainer only takes code that was looked at. */
  previewed: () => Promise<string[]>;
  /** False once the request is cancelled: a generation stops before it spends credits. */
  alive?: () => Promise<boolean>;
  /** The Assistant turn, for undo, read when the tool runs; absent over MCP, where undo is not offered. */
  readonly turnId?: string;
};

export async function clipScope(
  supabase: SupabaseClient,
  context: ClipContext,
  clipId: string,
  turn: Turn,
  checkpointed: boolean,
): Promise<Scope> {
  const checkpoint = checkpointing(supabase, turn, checkpointed);
  return clipScopeWith(supabase, context, clipId, {
    checkpoint: {
      take: () => (checkpoint.taken() ? null : { kind: "agent" as const, label: checkpoint.label }),
      mark: checkpoint.mark,
    },
    recordUsage: async (usage) => {
      await rpcOrThrow<number>(supabase, "agent_record_usage", {
        p_turn_id: turn.id,
        p_model: usage.model,
        p_input: usage.input,
        p_output: usage.output,
        p_cache_read: usage.cacheRead,
        p_cache_write: usage.cacheWrite,
      });
    },
    previewed: async () => {
      const { data } = await supabase
        .from("agent_tool_calls")
        .select("input")
        .eq("turn_id", turn.id)
        .eq("name", "preview_explainer")
        .eq("status", "done")
        .order("created_at", { ascending: false });
      return ((data ?? []) as { input: { code?: unknown } }[]).map((row) => String(row.input?.code ?? ""));
    },
    alive: async () => (await turnStatus(supabase, turn.id))?.status === "running",
    // Read when a tool runs, like the hooks above: `startTurn` builds the scope before the turn
    // exists and fills its id in afterwards.
    get turnId() {
      return turn.id || undefined;
    },
  });
}

export async function clipScopeWith(supabase: SupabaseClient, context: ClipContext, clipId: string, host: ClipHost): Promise<Scope> {
  const workspace = dbWorkspace(supabase, context, clipId, host.checkpoint);
  const env = { workspace };
  // A blank New edit gets the cut-by-words tools once a video on it has a transcript to cut by.
  const start = await workspace.read();
  const blank = context.clip.kind === "blank" && !speechSources(start.document).length;
  return {
    kind: "clip",
    tools: clipToolSpecs({ blank }),
    system: SYSTEM_PROMPT,
    async context() {
      const snapshot = await workspace.read();
      const [ctx, about, skills] = await Promise.all([
        workspace.opContext(snapshot.document, snapshot.manifest),
        supabase.from("clips").select("hook, reason").eq("id", clipId).maybeSingle().then(({ data }) => data ?? {}),
        skillIndex(supabase).catch(() => ""),
      ]);
      const pending = await transcribing(libraryVideos(snapshot.document, snapshot.manifest), workspace.transcriptStatus);
      return `${await clipContextBlock(snapshot.document, ctx, about as ClipAbout, pending).catch(() => "")}${skills}`;
    },
    async state() {
      // One read serves both the summary and the check.
      const project = await workspace.read();
      const block = projectStateBlock({ version: project.version, ...summarizeProject(project.document) });
      // Lượt tự kiểm (spec agent-editor §3.4): model thấy lỗi mới ngay sau bước ghi.
      const report = await runCheck(workspace, project).catch(() => null);
      return report ? `${block}${checkBlock(report)}` : block;
    },
    async plan(call) {
      if (call.name === "ask_user") {
        const parsed = askInput.safeParse(call.input);
        if (!parsed.success) {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: parsed.error.issues[0]?.message ?? "Invalid input." }), summary: "Could not ask" };
        }
        return {
          kind: "input",
          input: parsed.data,
          card: { question: parsed.data.question, options: parsed.data.options ?? [], multi: parsed.data.multi ?? false },
        };
      }
      if (CAPTION_TOOLS.has(call.name)) {
        // Báo giá ở đây: thứ người dùng duyệt (file, đoạn, số credit) đúng là thứ sẽ chạy.
        const snapshot = await workspace.read();
        const prepared = await prepareCaptions(supabase, clipId, call.name, call.input, snapshot);
        if (typeof prepared === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: prepared }), summary: "Could not prepare the captions" };
        }
        return { kind: "approval", input: prepared, card: captionsCard(prepared, clipId) };
      }
      if (call.name === "plan_video") {
        // The team plans here, before the card: the user approves the exact storyboard that is
        // applied. Its model calls are charged on this turn like the Assistant's own steps.
        const snapshot = await workspace.read();
        const clipContext = await clipContextBlock(snapshot.document, await workspace.opContext(snapshot.document, snapshot.manifest)).catch(() => "");
        const planned = await prepareVideo(call.input, { document: snapshot.document, clipContext }, host.recordUsage);
        if (typeof planned === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: planned }), summary: "Could not plan the intro" };
        }
        return { kind: "approval", input: planned.prepared, card: { ...planned.card, clips: [{ id: clipId, label: "This clip" }] } };
      }
      if (call.name === "request_export") {
        const prepared = await prepareExport(supabase, clipId, call.input);
        if (typeof prepared === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: prepared }), summary: "Could not prepare the export" };
        }
        return { kind: "approval", input: prepared, card: await exportCard(supabase, clipId, prepared) };
      }
      if (call.name === "generate_media") {
        // Chuẩn bị ở ĐÂY (chọn model, seed, giá) và lưu vào input của tool: thứ
        // người dùng duyệt đúng là thứ sẽ được tạo, không tính lại sau khi bấm.
        // Câu trích phải có thật trong clip: ảnh/video gắn với điều người nói nói.
        const target = await workspace.read().then(({ document }) => {
          const scene = activeScene(document) as unknown as { width: number; height: number };
          return { aspect: frameAspect(Number(scene.width), Number(scene.height)), speaker: JSON.stringify(document).includes(`"${MASTER_SRC}"`) };
        });
        const prepared = await prepareGeneration(
          call.input,
          async (quote) => {
            const snapshot = await workspace.read();
            return quoteRange(snapshot.document, await workspace.opContext(snapshot.document, snapshot.manifest), quote, { min: 1.5, max: 5 });
          },
          // Ảnh AI đã xong trong thư viện clip → tên object (dưới RLS, đúng project).
          async (path) => {
            const snapshot = await workspace.read();
            const assets = ((snapshot.manifest as { assets?: unknown[] } | null)?.assets ?? []) as { path?: string; type?: string; state?: string; cloud?: { mediaId?: string } }[];
            const record = assets.find((item) => item.path === path && item.type === "IMAGE" && !item.state && item.cloud?.mediaId);
            if (!record?.cloud?.mediaId) return null;
            const resolved = (await resolveMediaRefs(supabase, context.clip.job_id, { startImage: record.cloud.mediaId }).catch(() => null)) as { startImage?: string } | null;
            return resolved?.startImage ?? null;
          },
          target,
        );
        if (typeof prepared === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: prepared }), summary: "Could not prepare the generation" };
        }
        const blocked = await screen(prepared);
        if (blocked) return blocked;
        return { kind: "approval", input: prepared, card: generateCard(prepared, clipId) };
      }
      if (call.name === "add_3d_scene") {
        const prepared = await prepareScene(
          call.input,
          async (input) => {
            const snapshot = await workspace.read();
            return planStudio3d(snapshot.document, input, await workspace.opContext(snapshot.document, snapshot.manifest));
          },
          // Lưu ngay lúc báo giá: thẻ duyệt mang code_ref, bấm duyệt là render đúng code đó.
          (code) => rpcOrThrow<string>(supabase, "save_scene_code", { p_code: code }),
        );
        if (typeof prepared === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: prepared }), summary: "Could not prepare the 3D scene" };
        }
        const blocked = await screen(prepared);
        if (blocked) return blocked;
        return { kind: "approval", input: prepared, card: generateCard(prepared, clipId) };
      }
      if (call.name === "add_explainer") {
        // One check of everything the render shows or says: the script, and the words in the code
        // (the spec only holds the script, so `screen` alone would miss the labels). Before the code
        // is saved, so refused code never lands in `scene_codes`.
        const request = addExplainerInput.safeParse(call.input);
        if (request.success) {
          try {
            await moderateText(explainerText(request.data), { kind: "video" });
          } catch (err) {
            const message = err instanceof ApiError ? err.message : "Could not check this request. Please try again.";
            return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: message }), summary: message };
          }
        }
        const snapshot = await workspace.read();
        const accent = readBrand(snapshot.document)?.colors.accent;
        const prepared = await prepareExplainer(call.input, {
          // Code previewed in this turn: add_explainer only takes code the model has looked at.
          previewed: host.previewed,
          save: (code) => rpcOrThrow<string>(supabase, "save_scene_code", { p_code: code }),
          ...(accent ? { accent } : {}),
        });
        if (typeof prepared === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: prepared }), summary: "Could not prepare the explainer" };
        }
        return { kind: "approval", input: prepared, card: explainerCard(prepared, clipId) };
      }
      if (call.name === "create_video") {
        // The director plans here, before the card; its model calls are charged on this turn.
        const snapshot = await workspace.read();
        const planned = await prepareCreateVideo(call.input, { document: snapshot.document }, host.recordUsage);
        if (typeof planned === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: planned }), summary: "Could not plan the video" };
        }
        // Every piece starts on Approve: check the in-flight cap now, not after the user has approved.
        const needed = 1 + (planned.prepared.extra?.length ?? 0);
        const { count: running } = await supabase.from("generations").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
        if ((running ?? 0) + needed > GENERATION_ACTIVE_LIMIT) {
          const message = `This video needs ${needed} generations at once and ${running} are still running. Wait for them to finish, or ask for a shorter video.`;
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: message }), summary: "Too many generations running" };
        }
        const blocked = await screenPieces(videoPieces(planned));
        if (blocked) return { kind: "invalid", ...blocked };
        return { kind: "approval", input: planned.prepared, card: { ...generateCard(planned.prepared, clipId), storyboard: planned.storyboard } };
      }
      if (call.name === "replace_background") {
        const snapshot = await workspace.read();
        const prepared = prepareBackground(call.input, snapshot.document, await workspace.opContext(snapshot.document, snapshot.manifest));
        if (typeof prepared === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: prepared }), summary: "Could not prepare the new background" };
        }
        const blocked = await screen(prepared);
        if (blocked) return blocked;
        return { kind: "approval", input: prepared, card: generateCard(prepared, clipId) };
      }
      if (call.name === "edit_video") {
        const snapshot = await workspace.read();
        const prepared = prepareEdit(call.input, snapshot.document, await workspace.opContext(snapshot.document, snapshot.manifest));
        if (typeof prepared === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: prepared }), summary: "Could not prepare the video edit" };
        }
        const blocked = await screen(prepared);
        if (blocked) return blocked;
        return { kind: "approval", input: prepared, card: generateCard(prepared, clipId) };
      }
      if (call.name === "add_voiceover") {
        const prepared = await prepareVoiceover(call.input, async (input) => {
          const snapshot = await workspace.read();
          return planVoiceover(snapshot.document, input, await workspace.opContext(snapshot.document, snapshot.manifest));
        });
        if (typeof prepared === "string") {
          return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: prepared }), summary: "Could not prepare the voiceover" };
        }
        const blocked = await screen(prepared);
        if (blocked) return blocked;
        return { kind: "approval", input: prepared, card: generateCard(prepared, clipId) };
      }
      const schema = BROWSER_INPUTS[call.name];
      if (!schema) return { kind: "run" };
      const parsed = schema.safeParse(call.input);
      if (parsed.success) return { kind: "browser", input: parsed.data };
      return {
        kind: "invalid",
        content: JSON.stringify({ INVALID_INPUT: parsed.error.issues[0]?.message ?? "Invalid input." }),
        summary: "Invalid request to the editor",
      };
    },
    run: (call) =>
      call.name === "apply_brand_kit"
        ? runBrandTool(supabase, call.input, (op) => applyOpTool(op as never, env))
        : SKILL_TOOLS.has(call.name)
          ? runSkillTool(supabase, call)
          : TURN_TOOLS.has(call.name)
            ? runTurnTool(call.name, call.input, { supabase, clipId, ...(host.turnId ? { turnId: host.turnId } : {}) })
            : call.name === WAIT_TOOL_SPEC.name
              ? runWaitForMedia(call.input, { supabase, clipId })
              : call.name === "preview_explainer"
                ? workspace.read().then(({ document }) => {
                    const accent = readBrand(document)?.colors.accent;
                    return runPreviewExplainer(call.input, { preview: previewMotion, ...(accent ? { accent } : {}) });
                  })
                : runTool(call.name, call.input, env),
    async decide(call, input, approved) {
      if (call.name === "plan_video") {
        if (!approved) {
          return {
            outcome: { ok: false, content: JSON.stringify({ declined: true, message: "The user declined the storyboard. Nothing was added." }), summary: "Declined" },
            extra: {},
            wrote: false,
          };
        }
        const prepared = input as PreparedVideo;
        const outcome = await applyOpTool(prepared.op as never, env);
        return { outcome, extra: {}, wrote: outcome.ok && outcome.version !== undefined };
      }
      if (call.name === "request_export") {
        if (!approved) {
          return {
            outcome: { ok: false, content: JSON.stringify({ declined: true, message: "The user declined the export. Nothing was rendered." }), summary: "Declined" },
            extra: {},
            wrote: false,
          };
        }
        const outcome = await runExport({ supabase, context, clipId }, input as PreparedExport);
        // `view` lưu cùng kết quả: tải lại trang vẫn còn nút Download.
        return { outcome, extra: outcome.view ? { view: outcome.view } : {}, wrote: false };
      }
      if (CAPTION_TOOLS.has(call.name)) {
        if (!approved) {
          return {
            outcome: { ok: false, content: JSON.stringify({ declined: true, message: "The user declined. No credits were spent." }), summary: "Declined" },
            extra: {},
            wrote: false,
          };
        }
        const outcome = await runCaptions(supabase, clipId, input as PreparedCaptions, (op) => applyOpTool(op, env));
        return { outcome, extra: {}, wrote: outcome.ok && outcome.version !== undefined };
      }
      if (!PRICED_TOOLS.has(call.name)) throw new Error(`Clip scope has no approval tool ${call.name}.`);
      const prepared = input as PreparedGeneration;
      if (!approved) {
        return {
          outcome: { ok: false, content: JSON.stringify({ declined: true, message: "The user declined this generation. No credits were spent." }), summary: "Declined" },
          extra: {},
          wrote: false,
        };
      }
      const { outcome, generationId } = await runGeneration(
        {
          supabase,
          jobId: context.clip.job_id,
          clipId,
          applyOp: (op) => applyOpTool(op, env),
          ...(host.alive ? { alive: host.alive } : {}),
        },
        prepared as Parameters<typeof runGeneration>[1],
      );
      return { outcome, extra: generationId ? { generation_id: generationId } : {}, wrote: outcome.ok && outcome.version !== undefined };
    },
    isWrite: (name) => name === "undo" || name === "apply_brand_kit" || name === "plan_video" || CAPTION_TOOLS.has(name) || isWriteTool(name),
  };
}

/** Kết quả `check` nối sau `<project_state>`: chỉ khi có issue, để tin nhắn gọn. */
function checkBlock(report: Awaited<ReturnType<typeof runCheck>>): string {
  if (!report.issues.length) return "<check>ok</check>";
  return `<check>${JSON.stringify({ ok: report.ok, issues: report.issues.slice(0, 20) })}</check>`;
}

export function projectScope(supabase: SupabaseClient, jobId: string, turn: Turn, checkpointed: boolean): Scope {
  const checkpoint = checkpointing(supabase, turn, checkpointed);
  const env = { supabase, jobId };
  return {
    kind: "project",
    tools: PROJECT_TOOL_SPECS,
    system: PROJECT_SYSTEM_PROMPT,
    async state() {
      const clips = await projectClips(supabase, jobId);
      return projectStateBlock({ clips: clips.map((clip) => ({ id: clip.id, number: clip.idx + 1, hook: clipLabel(clip) })) });
    },
    async plan(call) {
      if (call.name !== "apply_to_clips") return { kind: "run" };
      const valid = await validateApply(env, call.input);
      if (typeof valid === "string") {
        return { kind: "invalid", content: JSON.stringify({ INVALID_INPUT: valid }), summary: "Could not prepare the change" };
      }
      return { kind: "approval", input: valid, card: await approvalCard(env, valid) };
    },
    run: (call) => runProjectRead(call.name, call.input, env),
    async decide(_call, input, approved) {
      const parsed = applyInput.parse(input);
      if (!approved) {
        return {
          outcome: { ok: false, content: JSON.stringify({ declined: true, message: "The user declined this change." }), summary: "Declined" },
          extra: { ops: parsed.ops },
          wrote: false,
        };
      }
      const { outcome, clips, versions } = await runApply(env, parsed, checkpoint.label, checkpoint.mark);
      return { outcome, extra: { ops: parsed.ops, clips: clips satisfies ClipOutcome[] }, wrote: versions > 0 };
    },
    isWrite: (name) => name === "apply_to_clips",
  };
}

/**
 * Phạm vi CMO chat: không clip, không project, không checkpoint. Tool chỉ đọc (tài liệu, lịch,
 * mạng xã hội qua ScrapeCreators) hoặc giao việc (`create_task`); không có thẻ duyệt vì không tool
 * nào tốn tiền ngoài credit của việc được giao, và không tool nào đăng gì. Ngân sách lời gọi
 * research tính theo YÊU CẦU (scope dựng lại mỗi lượt).
 */
export function cmoScope(supabase: SupabaseClient): Scope {
  const budget = new ScBudget(RESEARCH_CALLS_PER_TURN);
  const turn: CmoTurn = { siteReads: 0 };
  return {
    kind: "cmo",
    tools: CMO_TOOL_SPECS,
    system: `${CMO_SYSTEM_PROMPT}\n\nYour playbooks and marketing library (read one with read_skill before planning research, writing a brief or advising on strategy):\n${cmoSkillIndex("cmo")}`,
    context: () => cmoContext(supabase),
    state: () => cmoState(supabase),
    async plan() {
      return { kind: "run" };
    },
    run: (call) => (RESEARCH_TOOLS.has(call.name) ? runResearchTool(call.name, call.input, budget) : runCmoTool(supabase, call.name, call.input, turn)),
    async decide(call) {
      throw new Error(`CMO scope has no approval tool ${call.name}.`);
    },
    isWrite: isCmoWrite,
  };
}
