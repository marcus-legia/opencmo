/**
 * Gemini provider (`@google/genai`), the alternative to Claude when Anthropic is unavailable or
 * a run is measured on another model family.
 *
 * History is stored as Gemini's NATIVE `parts` and sent back untouched: Gemini attaches a
 * `thoughtSignature` to parts and requires the same part on the next call, so merging or editing
 * parts loses its reasoning between tool calls.
 *
 * Tools are `functionDeclarations` built from the same specs as Claude's (`TOOL_SPECS`). The SDK's
 * automatic function calling is off: our loop runs the tools. Anthropic-only features (tool search,
 * context editing, strict tools, server-side fallback) have no equivalent here.
 */

import { ApiError, FinishReason, GoogleGenAI, type Content, type Part } from "@google/genai";

import type { ToolSpec } from "../tools";
import { NOT_COMPLETED } from "./anthropic";
import { callId, geminiFormat } from "./gemini-history";
import { StepAborted, streamedTokens, type Delta, type Provider, type Step, type StepRequest, type StoredMessage, type ToolCall } from "./types";

/** Latest Pro; override with `AGENT_GEMINI_MODEL` (e.g. a pinned id from `models.list`). */
export const GEMINI_MODEL = process.env.AGENT_GEMINI_MODEL || "gemini-pro-latest";

export const geminiKey = (env: NodeJS.ProcessEnv = process.env): string => env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "";

const MAX_OUTPUT_TOKENS = 32_768;

const REFUSALS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

const declarations = (specs: ToolSpec[]) =>
  specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parametersJsonSchema: spec.schema,
  }));

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429 || error.status >= 500) return "The assistant is busy right now. Try again in a moment.";
    return "The assistant could not process this request.";
  }
  return "Something went wrong. Please try again.";
}

/**
 * Gemini rejects a function call without a response in the next turn. A turn that was stopped (or
 * replaced by a new one) leaves such calls behind: answer them with the stored result when the tool
 * did run, or with "not completed" so the model does not assume it ran. Pure: history is not edited.
 */
export function closeDanglingCalls(history: StoredMessage[], ran: Map<string, { ok: boolean; content: string }> = new Map()): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (let index = 0; index < history.length; index++) {
    const message = history[index]!;
    out.push(message);
    if (message.role !== "assistant") continue;
    const calls = geminiFormat.callsIn(message.content);
    if (!calls.length) continue;
    const next = history[index + 1];
    const nextParts = next?.role === "user" ? (next.content as Part[]) : null;
    const answered = (nextParts ?? []).filter((part) => part.functionResponse).length;
    // Responses go in call order, so the first `answered` calls are the answered ones.
    const missing = calls.slice(answered);
    if (!missing.length) continue;
    const results = geminiFormat.toolResults(
      missing.map((call) => {
        const done = ran.get(call.id);
        return { id: call.id, name: call.name, ok: done?.ok ?? false, content: done?.content ?? JSON.stringify(NOT_COMPLETED) };
      }),
    ) as Part[];
    if (nextParts) {
      const existing = nextParts.filter((part) => part.functionResponse);
      const rest = nextParts.filter((part) => !part.functionResponse);
      out.push({ ...next!, content: [...existing, ...results, ...rest] });
      index++;
    } else {
      out.push({ role: "user", content: results });
    }
  }
  return out;
}

const toContents = (history: StoredMessage[]): Content[] =>
  history.map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: message.content as Part[] }));

/**
 * `client` lets a check replace the real client with recorded responses (no network). `modelId`: a
 * CMO agent picks its own model (`lib/cmo/agents/registry.ts`); default is the Assistant's.
 */
export function geminiProvider(apiKey: string, client?: Pick<GoogleGenAI, "models">, modelId: string = GEMINI_MODEL): Provider {
  const ai = client ?? new GoogleGenAI({ apiKey });

  return {
    ...geminiFormat,
    model: modelId,
    failureMessage,
    async step({ history, tools, system, signal, ran }: StepRequest, onDelta: (delta: Delta) => void): Promise<Step> {
      const stream = await ai.models.generateContentStream({
        model: modelId,
        contents: toContents(closeDanglingCalls(history, ran)),
        config: {
          systemInstruction: system,
          tools: [{ functionDeclarations: declarations(tools) }],
          thinkingConfig: { includeThoughts: true },
          automaticFunctionCalling: { disable: true },
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: signal,
        },
      });

      // Keep EVERY part exactly as received, in order: text, thoughts, function calls and the
      // `thoughtSignature` attached to them.
      const parts: Part[] = [];
      let finish: string | undefined;
      let blocked = false;
      let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let model = modelId;

      let streamed = 0;
      try {
        for await (const chunk of stream) {
          if (chunk.promptFeedback?.blockReason) blocked = true;
          const candidate = chunk.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) {
            parts.push(part);
            if (part.functionCall) {
              onDelta({ type: "tool_start", id: callId(part, parts.length - 1), name: part.functionCall.name ?? "" });
            } else if (part.text) {
              streamed += part.text.length;
              onDelta({ type: part.thought ? "thinking" : "text", text: part.text });
            }
          }
          if (candidate?.finishReason) finish = candidate.finishReason;
          if (chunk.modelVersion) model = chunk.modelVersion;
          const meta = chunk.usageMetadata;
          if (meta) {
            const cached = meta.cachedContentTokenCount ?? 0;
            usage = {
              // `promptTokenCount` includes the cached part; the cached part is billed at the cache price.
              input: Math.max(0, (meta.promptTokenCount ?? 0) - cached),
              output: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
              cacheRead: cached,
              cacheWrite: 0,
            };
          }
        }
      } catch (err) {
        if (signal?.aborted) throw new StepAborted({ ...usage, output: streamedTokens(streamed, usage.output) }, model);
        throw err;
      }

      const calls: ToolCall[] = geminiFormat.callsIn(parts);
      return {
        content: parts,
        toolCalls: calls,
        stop:
          blocked || (finish && REFUSALS.has(finish))
            ? "refusal"
            : finish === FinishReason.MAX_TOKENS
              ? "max_tokens"
              : calls.length
                ? "tool"
                : "end",
        usage,
        model,
      };
    },
  };
}
