import "server-only";

/**
 * Picks the Assistant's provider: Claude only (owner, 2026-11-05).
 *
 * - `OPENCMO_AGENT_FAKE=1` (never in production): the scripted model for CI/E2E.
 * - Otherwise Claude (`ANTHROPIC_MODEL`) when the server has an Anthropic key.
 *
 * A session is bound to the model it started on (native history): `providerForModel` rebuilds it,
 * or returns null when that model is gone (an older Claude id, or a chat from the removed Gemini).
 */

import { agentCandidates, type AgentId } from "@/lib/cmo/agents/registry";

import { ANTHROPIC_MODEL, anthropicFormat, anthropicProvider } from "./providers/anthropic";
import { fakeProvider } from "./providers/fake";
import type { Format, Provider, ProviderKind } from "./providers/types";
import { isDown } from "@/lib/llm-health";
import { agentFakeAllowed } from "@/lib/production";

const fakeAllowed = agentFakeAllowed;

const hasAnthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Provider for a NEW session, or null when the Assistant is not set up. */
export function agentProvider(): Provider | null {
  if (fakeAllowed()) return fakeProvider;
  return hasAnthropicKey() ? anthropicProvider() : null;
}

/** True while the Assistant's model is remembered as unable to answer. */
export function assistantDown(model: string): boolean {
  return kindOf(model) === "anthropic" && isDown("anthropic", ANTHROPIC_MODEL);
}

/**
 * Provider for a CMO agent that chats (H1): model and key come from the agent registry
 * (`CMO_AGENT_<ID>_*`), not from the editor Assistant. Null when there is no key for it.
 */
export function agentChatProvider(id: AgentId): Provider | null {
  if (fakeAllowed()) return fakeProvider;
  const [agent] = agentCandidates(id);
  if (!agent) return null;
  return { ...anthropicProvider(agent.model, agent.apiKey), ownKey: agent.ownKey };
}

/** Provider family of a saved model id; `retired` for a chat on a provider that was removed. */
export const kindOf = (model: string): ProviderKind | "retired" =>
  model === "fake" ? "fake" : model.startsWith("claude-") ? "anthropic" : "retired";

/** History format of a session — needs no key, used to draw the panel. */
export const formatFor = (model: string): Format => ({ kind: kindOf(model) === "fake" ? "fake" : "anthropic", ...anthropicFormat });

/** Provider to continue an existing session; null when the server cannot run it any more. */
export function providerForModel(model: string): Provider | null {
  switch (kindOf(model)) {
    case "fake":
      return fakeAllowed() ? fakeProvider : null;
    case "anthropic":
      return hasAnthropicKey() && model === ANTHROPIC_MODEL ? anthropicProvider() : null;
    default:
      return null;
  }
}

/** Models the panel can offer (only those the server has a key for). */
export function availableModels(): { id: string; label: string }[] {
  if (fakeAllowed()) return [{ id: "fake", label: "Test model" }];
  return hasAnthropicKey() ? [{ id: ANTHROPIC_MODEL, label: "Claude Sonnet 5.5" }] : [];
}
