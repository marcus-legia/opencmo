/**
 * Provider Claude (Anthropic) — logic của P2, sau giao diện trung lập.
 *
 * Tham số theo skill `claude-api`: adaptive thinking `summarized`, server-side
 * fallback `"default"`, tool `strict` + `eager_input_streaming` (input được
 * zod kiểm lại ở `tools.ts` trước khi chạy), cache ở system và đuôi hội thoại.
 */

import Anthropic from "@anthropic-ai/sdk";

import { MAX_TOKENS } from "../limits";
import type { ToolSpec } from "../tools";
import { IMAGE_OMITTED, type Delta, type Format, type Provider, type Step, type StepRequest, type StoredMessage, type ToolCall, type ToolResult } from "./types";

type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

/** Beta header của `fallbacks: "default"`. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/**
 * Thinking blocks are bound to the system prompt and tool list that produced them. A deploy that
 * changes either (or `trimImages` replacing an old image) would make every stored conversation
 * fail with a 400; with `drop_block` the API drops the stale blocks and the turn still runs.
 */
const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";

export const ANTHROPIC_MODEL = "claude-sonnet-5-5";

const CONTEXT_BETA = "context-management-2025-06-27";

/**
 * Server-side clearing of old tool results (context editing), behind OPENCMO_AGENT_CONTEXT_EDITING=1
 * until a real-model eval shows it pays. Long sessions resend every transcript, document and
 * library listing they ever read; past 80k input tokens the oldest results become a placeholder,
 * the last six stay, and at least 20k go at once, because each clearing rewrites the cache from that
 * point. Guides, skills and the plan are instructions the model keeps working from: never cleared.
 * The stored history is untouched, and server-side edits never invalidate thinking blocks.
 */
export function contextEditing(env: NodeJS.ProcessEnv = process.env) {
  if (env.OPENCMO_AGENT_CONTEXT_EDITING !== "1") return null;
  return {
    beta: CONTEXT_BETA,
    context_management: {
      edits: [
        {
          type: "clear_tool_uses_20250919" as const,
          trigger: { type: "input_tokens" as const, value: 80_000 },
          keep: { type: "tool_uses" as const, value: 6 },
          clear_at_least: { type: "input_tokens" as const, value: 20_000 },
          exclude_tools: ["read_guide", "read_skill", "update_plan"],
        },
      ],
    },
  };
}

/** Định dạng content block của Claude — dùng chung cho Claude giả. */
export const anthropicFormat: Omit<Format, "kind"> = {
  danglingCalls: (history) => danglingToolUses(history),
  userTurn: (prompt, state, images) => [
    { type: "text", text: prompt },
    ...(images ?? []).map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.mimeType, data: image.data },
    })),
    { type: "text", text: state },
  ],
  toolResults(results: ToolResult[], state?: string) {
    const blocks: Block[] = results.map((result) => ({
      type: "tool_result",
      tool_use_id: result.id,
      content: result.images?.length
        ? [
            { type: "text", text: result.content },
            ...result.images.map((image) => ({
              type: "image" as const,
              source: { type: "base64" as const, media_type: image.mimeType, data: image.data },
            })),
          ]
        : result.content,
      ...(result.ok ? {} : { is_error: true }),
    }));
    // tool_result đứng trước, chữ đứng sau — thứ tự API đòi.
    if (state) blocks.push({ type: "text", text: state });
    return blocks;
  },
  callsIn: (content) =>
    (content as Array<{ type?: string; id?: string; name?: string; input?: unknown }>)
      .filter((block) => block.type === "tool_use")
      .map((block) => ({ id: block.id!, name: block.name!, input: block.input })),
  replyText: (content) =>
    (content as Array<{ type?: string; text?: string }>)
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text!)
      .join("\n\n"),
  trimImages(history: StoredMessage[], keep: number, window = 0): StoredMessage[] {
    type Item = { type?: string; content?: unknown };
    // Ảnh nằm trong tool_result (capture) HOẶC thẳng trong tin nhắn (khung người dùng đính kèm).
    const hasImage = (message: StoredMessage) =>
      message.role === "user" &&
      (message.content as Item[]).some(
        (block) => block.type === "image" || (Array.isArray(block.content) && (block.content as Item[]).some((part) => part.type === "image")),
      );
    const live = keep + imagesOver(history.filter(hasImage).length, keep, window);
    let seen = 0;
    const out = [...history];
    for (let index = out.length - 1; index >= 0; index--) {
      const message = out[index]!;
      if (!hasImage(message) || ++seen <= live) continue;
      out[index] = {
        ...message,
        content: (message.content as Item[]).map((block) =>
          block.type === "image"
            ? { type: "text", text: IMAGE_OMITTED }
            : Array.isArray(block.content)
            ? {
                ...block,
                content: (block.content as Item[]).map((part) => (part.type === "image" ? { type: "text", text: IMAGE_OMITTED } : part)),
              }
            : block,
        ),
      };
    }
    return out;
  },
};

/**
 * How many images beyond `keep` stay, out of `count`: up to `window` more pile up before the oldest
 * are cut back to `keep` together. Omitting an image rewrites its message, and the prompt cache
 * from that message on, so cutting in steps rewrites it every `window` captures instead of every one.
 */
export function imagesOver(count: number, keep: number, window: number): number {
  if (window <= 0 || count <= keep + window) return Math.max(0, Math.min(count - keep, window));
  return (count - keep - window - 1) % window;
}

/**
 * Strict grammar limits: the API rejects a request with more strict tools than this, or with more
 * optional parameters summed over all strict schemas (both are 400 invalid_request_error). A third
 * limit, total grammar size, can't be computed here — `step` falls back to no strict for that.
 */
export const MAX_STRICT_TOOLS = 20;
export const MAX_STRICT_OPTIONAL = 24;

/** Tools that spend credits: a malformed call here costs the user money, so they get strict first. */
const PRICED = new Set(["generate_media", "add_3d_scene", "add_voiceover", "replace_background", "create_video", "edit_video"]);

/**
 * Which strict-eligible tools are actually sent as strict. The clip scope has far more eligible
 * tools than the API allows; the rest still have their input checked by zod before they run, so
 * strict is a quality nicety, not the guard.
 */
export function strictTools(specs: ToolSpec[]): Set<string> {
  const eligible = specs.filter((spec) => spec.strict);
  // Smallest schemas first: one large schema (generate_media) can use up the whole budget.
  const first = eligible
    .filter((spec) => spec.approval || PRICED.has(spec.name))
    .sort((a, b) => optionalParams(a.schema) - optionalParams(b.schema));
  const rest = eligible.filter((spec) => !first.includes(spec));
  const chosen = new Set<string>();
  let optional = 0;
  for (const spec of [...first, ...rest]) {
    if (chosen.size >= MAX_STRICT_TOOLS) break;
    const count = optionalParams(spec.schema);
    if (optional + count > MAX_STRICT_OPTIONAL) continue;
    optional += count;
    chosen.add(spec.name);
  }
  return chosen;
}

/** Object properties not listed in `required`, at every depth of the schema. */
export function optionalParams(schema: unknown): number {
  if (Array.isArray(schema)) return schema.reduce((sum: number, item) => sum + optionalParams(item), 0);
  if (!schema || typeof schema !== "object") return 0;
  const node = schema as Record<string, unknown>;
  let count = 0;
  if (node.properties && typeof node.properties === "object") {
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    count += Object.keys(node.properties).filter((name) => !required.has(name)).length;
  }
  for (const value of Object.values(node)) count += optionalParams(value);
  return count;
}

/**
 * Tools always in context when tool search is on: the routing targets of the system prompt and the
 * tools nearly every edit uses. The rest (colour, layouts, keyframe and timeline detail, icons,
 * animations, markers, audio, 3D preview…) load when the model searches for them.
 */
export const ALWAYS_LOADED = new Set([
  "get_project_state", "get_document", "get_transcript", "search_transcript", "list_library", "check", "read_guide", "read_skill",
  "update_plan", "ask_user", "capture", "media_grab",
  "insert_asset", "place_broll", "wait_for_media", "add_text", "set_props", "set_keyframe", "add_part", "delete_element", "move_elements", "trim_element", "split_elements",
  "set_frame", "set_layout", "set_caption_style", "remove_words", "remove_ranges", "remove_silence", "find_filler_words", "find_silences", "undo",
  "add_diagram", "add_chart", "add_shape",
  "create_video", "edit_video", "replace_background", "plan_video", "generate_media", "add_voiceover", "add_3d_scene", "request_export", "add_captions",
]);

const TOOL_SEARCH = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" } as const;

/** Appended to the system prompt when tool search is on (fixed text: the cache prefix holds). */
export const TOOL_SEARCH_NOTE =
  "\n\nSpecialised tools load on demand: colour grading, layouts of several sources, icons and animations, graphs, staggered reveals, markers, timelines and rows, fades and audio, slips, grouping, copy_settings, 3D preview and more. Search for one with tool_search_tool_bm25 by what you need (\"color grade\", \"animated icon\", \"split screen layout\"), or by the name the guide gives, then call it.";

/**
 * Deferred tool loading (tool search), behind OPENCMO_AGENT_TOOL_SEARCH=1 until a real-model eval
 * shows it pays: ~90 tool definitions (about 17k tokens) shrink to the ~45 in ALWAYS_LOADED, and
 * the model's choice among them gets easier. Deferred tools leave the cached prefix untouched.
 */
export const toolSearchOn = (env: NodeJS.ProcessEnv = process.env): boolean => env.OPENCMO_AGENT_TOOL_SEARCH === "1";

export const toolDefinitions = (specs: ToolSpec[], useStrict: boolean, search = false): Anthropic.Beta.BetaToolUnion[] => {
  const strict = useStrict ? strictTools(specs) : new Set<string>();
  const tools: Anthropic.Beta.BetaToolUnion[] = specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    input_schema: spec.schema as Anthropic.Beta.BetaTool["input_schema"],
    // Eager streaming turns off the API's own JSON check of the input. Only strict tools keep it:
    // their grammar guarantees valid JSON. A non-strict tool without it gets its input checked,
    // instead of the model's broken JSON ("avoid": text, logos) failing the whole turn.
    ...(strict.has(spec.name) ? { strict: true, eager_input_streaming: true } : {}),
    ...(search && !ALWAYS_LOADED.has(spec.name) ? { defer_loading: true } : {}),
  }));
  return search ? [TOOL_SEARCH, ...tools] : tools;
};

/** Shown to the model for a tool call its turn never answered (stopped, or replaced by a new turn). */
export const NOT_COMPLETED = "Not completed: the turn was stopped before this tool ran.";

/**
 * Every `tool_use` must be answered by a `tool_result` in the next message, or the API rejects the
 * whole conversation. A turn that is stopped (or closed by a new prompt) while tools are pending
 * leaves them unanswered in the stored history, and every later turn in that chat would fail.
 * Answer them here as not completed; the stored history is left as it is.
 */
/** Ids of `tool_use` blocks no `tool_result` answers: what `closeDanglingToolUses` fills in. */
export function danglingToolUses(history: StoredMessage[]): string[] {
  type Item = { type?: string; id?: string; tool_use_id?: string };
  const out: string[] = [];
  history.forEach((message, index) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) return;
    const next = history[index + 1];
    const answered = new Set(
      (next?.role === "user" && Array.isArray(next.content) ? (next.content as Item[]) : []).filter((block) => block.type === "tool_result").map((block) => block.tool_use_id),
    );
    for (const block of message.content as Item[]) if (block.type === "tool_use" && !answered.has(block.id)) out.push(block.id!);
  });
  return out;
}

export function closeDanglingToolUses(history: StoredMessage[], ran: Map<string, { ok: boolean; content: string }> = new Map()): StoredMessage[] {
  type Item = { type?: string; id?: string; tool_use_id?: string };
  const out: StoredMessage[] = [];
  for (let index = 0; index < history.length; index++) {
    const message = history[index]!;
    out.push(message);
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const ids = (message.content as Item[]).filter((block) => block.type === "tool_use").map((block) => block.id!);
    if (!ids.length) continue;
    const next = history[index + 1];
    const nextBlocks = next?.role === "user" && Array.isArray(next.content) ? (next.content as Item[]) : null;
    const answered = new Set((nextBlocks ?? []).filter((block) => block.type === "tool_result").map((block) => block.tool_use_id));
    const missing = ids.filter((id) => !answered.has(id));
    if (!missing.length) continue;
    const results = missing.map((id) => {
      const done = ran.get(id);
      return { type: "tool_result", tool_use_id: id, content: done?.content ?? NOT_COMPLETED, is_error: done ? !done.ok : true };
    });
    if (nextBlocks) {
      // tool_result blocks go first in the user message, before any text.
      const existing = nextBlocks.filter((block) => block.type === "tool_result");
      const rest = nextBlocks.filter((block) => block.type !== "tool_result");
      out.push({ ...next!, content: [...existing, ...results, ...rest] });
      index++;
    } else {
      out.push({ role: "user", content: results });
    }
  }
  return out;
}

/** 400s caused by the strict tool grammar, e.g. "Too many strict tools", "compiled grammar is too large". */
function isStrictLimit(err: unknown): boolean {
  return err instanceof Anthropic.BadRequestError && /strict|grammar|optional parameters/i.test(err.message);
}

function failureMessage(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
    return "The assistant is busy right now. Try again in a moment.";
  }
  if (err instanceof Anthropic.APIConnectionError) return "The assistant could not be reached. Try again in a moment.";
  if (err instanceof Anthropic.APIError) return "The assistant could not process this request.";
  return "Something went wrong. Please try again.";
}

/** `model` / `apiKey`: agent CMO cấu hình riêng (H1); vắng thì model + khoá chung của Assistant. */
export function anthropicProvider(model: string = ANTHROPIC_MODEL, apiKey?: string): Provider {
  const client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();

  return {
    kind: "anthropic",
    model,
    ...anthropicFormat,
    failureMessage,
    async step({ history, tools: specs, system, signal, ran }: StepRequest, onDelta: (delta: Delta) => void): Promise<Step> {
      let jsonRetries = 0;
      let useStrict = true;
      const editing = contextEditing();
      // The CMO and project scopes have few tools; only the editor's large set is worth searching.
      const search = toolSearchOn() && specs.length > ALWAYS_LOADED.size;
      for (;;) {
        const stream = client.beta.messages.stream({
          model,
          max_tokens: MAX_TOKENS,
          thinking: { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } },
          system: [{ type: "text", text: search ? `${system}${TOOL_SEARCH_NOTE}` : system, cache_control: { type: "ephemeral" } }],
          // Breakpoint thứ hai: đuôi hội thoại, để bước sau chỉ trả phần mới.
          cache_control: { type: "ephemeral" },
          tools: toolDefinitions(specs, useStrict, search),
          messages: closeDanglingToolUses(history, ran) as Anthropic.Beta.Messages.BetaMessageParam[],
          betas: [FALLBACK_BETA, THINKING_BINDING_BETA, ...(editing ? [editing.beta] : [])],
          fallbacks: "default",
          ...(editing ? { context_management: editing.context_management } : {}),
        }, { signal });
        try {
          for await (const event of stream) {
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              onDelta({ type: "tool_start", id: event.content_block.id, name: event.content_block.name });
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") onDelta({ type: "text", text: event.delta.text });
              else if (event.delta.type === "thinking_delta") onDelta({ type: "thinking", text: event.delta.thinking });
            }
          }
          const message = await stream.finalMessage();
          const calls: ToolCall[] = anthropicFormat.callsIn(message.content);
          return {
            content: message.content,
            toolCalls: calls,
            stop:
              message.stop_reason === "refusal"
                ? "refusal"
                : message.stop_reason === "max_tokens"
                  ? "max_tokens"
                  : calls.length
                    ? "tool"
                    : "end",
            usage: {
              input: message.usage.input_tokens ?? 0,
              output: message.usage.output_tokens ?? 0,
              cacheRead: message.usage.cache_read_input_tokens ?? 0,
              cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
            },
            model: message.model,
          };
        } catch (err) {
          // Eager input streaming: JSON tool input hỏng làm stream ném lúc khối
          // đóng. Chỉ trường hợp đó được gửi lại (tối đa 2 lần); lỗi API thì không.
          if (useStrict && isStrictLimit(err)) {
            // A schema change pushed the strict grammar over a limit: run the turn without strict
            // (zod still checks every input) instead of failing it.
            console.warn("[agent] strict tools rejected, retrying without strict", (err as Error).message);
            useStrict = false;
            continue;
          }
          if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        }
      }
    },
  };
}
