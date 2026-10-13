/**
 * Which LLM provider can answer right now.
 *
 * The product runs on Claude or Gemini. When one of them cannot answer (no credit, a revoked key,
 * rate limits, an outage), a call moves to the other and the failed one is skipped for a while, so
 * the next user does not pay for the same failure. The memory is per server instance: every
 * instance learns from its own first failure.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@google/genai";

export type LlmProvider = "anthropic" | "gemini";

/** `account`: the key or its credit; someone must fix it. `busy`: rate limit or outage; it passes. */
export type Outage = "account" | "busy";

const SKIP_MS: Record<Outage, number> = { account: 10 * 60_000, busy: 60_000 };

/** The kind of outage an SDK error means, or null when the provider answered and the request is at fault. */
export function outage(error: unknown): Outage | null {
  if (error instanceof Anthropic.APIConnectionError) return "busy";
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    if (status === 401 || status === 403 || status === 402) return "account";
    // Anthropic reports an empty balance as a 400 invalid_request_error.
    if (status === 400 && /credit balance|billing/i.test(error.message)) return "account";
    return status === 429 || status >= 500 ? "busy" : null;
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return "account";
    if (error.status === 400 && /api key/i.test(error.message)) return "account";
    return error.status === 429 || error.status >= 500 ? "busy" : null;
  }
  return null;
}

const downUntil = new Map<LlmProvider, number>();

export function markDown(provider: LlmProvider, kind: Outage, now: number = Date.now()): void {
  downUntil.set(provider, Math.max(downUntil.get(provider) ?? 0, now + SKIP_MS[kind]));
}

export const isDown = (provider: LlmProvider, now: number = Date.now()): boolean => (downUntil.get(provider) ?? 0) > now;

export function clearHealth(): void {
  downUntil.clear();
}

/** `candidates` in configured order, healthy ones first. All down: the configured order, to try anyway. */
export function healthyFirst<A extends { provider: LlmProvider }>(candidates: A[]): A[] {
  const up = candidates.filter((candidate) => !isDown(candidate.provider));
  return up.length ? up : candidates;
}

/**
 * Runs `call` on the first healthy candidate and moves to the next only when the provider itself
 * could not answer. Any other error is the caller's to report. When every candidate is out, the
 * first one's error is thrown: that is the provider the configuration asked for.
 */
export async function withFailover<A extends { provider: LlmProvider }, T>(candidates: A[], call: (candidate: A) => Promise<T>): Promise<T> {
  const order = healthyFirst(candidates);
  let first: unknown;
  for (const [index, candidate] of order.entries()) {
    try {
      return await call(candidate);
    } catch (error) {
      const kind = outage(error);
      if (!kind) throw error;
      markDown(candidate.provider, kind);
      if (index === 0) first = error;
      if (kind === "account") console.error(`[llm] ${candidate.provider} cannot answer (key or credit)${index < order.length - 1 ? "; using the other provider" : ""}`);
    }
  }
  throw first;
}
