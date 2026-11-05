import "server-only";

/**
 * One door for every CMO model call (W0, W1, W2…): structured output held to a zod schema, API errors mapped to an
 * English sentence for the founder. The provider, model and key follow the calling AGENT (H1): each job says which
 * agent it is, and the agent registry decides what it runs on.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { agentCandidates, type AgentId, type ResolvedAgent } from "@/lib/cmo/agents/registry";

import { outage, withFailover } from "@/lib/llm-health";

import { LlmError } from "./llm-error";
import { agentFakeAllowed } from "@/lib/production";
import { assertSpendAllowed, recordSpend, spendProviderOf } from "@/lib/spend/record";

export { LlmError };

/** The fake for CI and e2e. Never on in production. */
export const fakeAllowed = agentFakeAllowed;

/** The agent can run: the fake, or the server has a key for it. */
export function llmReady(agent: AgentId = "planner"): boolean {
  return fakeAllowed() || agentCandidates(agent).length > 0;
}

export type StructuredOptions<S extends z.ZodType> = {
  /** The agent in the registry (`lib/cmo/agents/registry.ts`): it decides the provider, model and key. */
  agent: AgentId;
  system: string;
  prompt: string;
  schema: S;
  maxTokens?: number;
  /** A label for internal logs. */
  label: string;
  /** The generic error sentence for the founder (English). */
  failure: string;
  /** Request time limit; the SDK default is ten minutes. */
  timeoutMs?: number;
  /** Token usage of the call, for callers that charge it (the editor's Video agent team). */
  onUsage?: (usage: LlmUsage) => void | Promise<void>;
};

export type LlmUsage = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number };

const usageListeners = new Set<(usage: LlmUsage, agent: AgentId) => void>();

/**
 * Every structured call's usage, process-wide. Only the eval CLIs listen (to cap what a run spends);
 * a server never registers one, so production has no shared state here.
 */
export function onLlmUsage(listener: (usage: LlmUsage, agent: AgentId) => void): () => void {
  usageListeners.add(listener);
  return () => usageListeners.delete(listener);
}

/** One call on exactly this provider; an outage is thrown as is, for the caller to fall through. */
export function structuredOn<S extends z.ZodType>(opts: StructuredOptions<S>, agent: ResolvedAgent): Promise<z.infer<S>> {
  return structuredAnthropic(opts, agent);
}

/**
 * One structured call on the agent's Claude model. When Claude cannot answer (no credit, a bad key,
 * rate limits, an outage), `llm-health` remembers it so the next call fails fast with a clear sentence.
 */
/** Every call's usage also goes to the spend ledger, under the provider that actually answered. */
function recorded<S extends z.ZodType>(opts: StructuredOptions<S>, agent: ResolvedAgent): StructuredOptions<S> {
  return {
    ...opts,
    onUsage: async (usage) => {
      await recordSpend(spendProviderOf(agent.provider), usage.model, {
        input: usage.input,
        output: usage.output,
        cache_read: usage.cacheRead,
        cache_write: usage.cacheWrite,
      });
      await opts.onUsage?.(usage);
    },
  };
}

export async function structured<S extends z.ZodType>(input: StructuredOptions<S>): Promise<z.infer<S>> {
  const opts: StructuredOptions<S> = usageListeners.size
    ? {
        ...input,
        onUsage: async (usage) => {
          for (const listener of usageListeners) listener(usage, input.agent);
          await input.onUsage?.(usage);
        },
      }
    : input;
  const candidates = agentCandidates(opts.agent);
  if (!candidates.length) throw new LlmError("The AI CMO is not set up on this server yet.");
  try {
    // The founder's daily provider cap (spend ledger): refused before the call, never after it.
    await assertSpendAllowed();
    return await withFailover(candidates, (agent) => structuredOn(recorded(opts, agent), agent), (agent) => !agent.ownKey);
  } catch (error) {
    if (error instanceof LlmError) throw error;
    const kind = outage(error);
    if (!kind) throw error;
    console.error(`[cmo] ${opts.label} (${opts.agent}): no provider could answer`, error instanceof Error ? error.message : error);
    throw new LlmError(kind === "account" ? opts.failure : "Our AI is busy right now. Try again in a minute.");
  }
}

async function structuredAnthropic<S extends z.ZodType>(opts: StructuredOptions<S>, agent: ResolvedAgent): Promise<z.infer<S>> {
  const client = new Anthropic({ apiKey: agent.apiKey });
  // Opus and Sonnet 5.5 have server-side fallback; Haiku has none. Haiku 5.5 thinks by default
  // (effort medium): a check runs at low. Haiku 4.5 rejects `effort`.
  const drafts = agent.model.startsWith("claude-opus") || agent.model.startsWith("claude-sonnet-5-5");
  const effort = drafts ? "medium" : agent.model.startsWith("claude-haiku-5") ? "low" : undefined;
  let response;
  try {
    response = await client.beta.messages.parse({
      model: agent.model,
      max_tokens: opts.maxTokens ?? 8000,
      output_config: effort ? { effort, format: betaZodOutputFormat(opts.schema) } : { format: betaZodOutputFormat(opts.schema) },
      ...(drafts ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      // Each agent's system prompt is fixed text (motion director, video director: several
      // thousand tokens), so repeat calls and fix rounds read it from the cache.
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.prompt }],
    }, opts.timeoutMs ? { timeout: opts.timeoutMs, maxRetries: 1 } : undefined);
  } catch (error) {
    if (outage(error)) throw error;
    if (error instanceof Anthropic.APIError) console.error(`[cmo] ${opts.label} (${agent.id}/${agent.model}): API error`, error.status, error.message);
    else console.error(`[cmo] ${opts.label}: parse or other error`, error);
    throw new LlmError(opts.failure);
  }
  await opts.onUsage?.({
    model: response.model,
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
  });
  if (response.stop_reason === "refusal") throw new LlmError(opts.failure);
  if (response.stop_reason === "max_tokens" || !response.parsed_output) throw new LlmError(opts.failure);
  return response.parsed_output as z.infer<S>;
}
