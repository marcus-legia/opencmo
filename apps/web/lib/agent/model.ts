import "server-only";

/**
 * Picks the Assistant's provider.
 *
 * - `OPENCMO_AGENT_FAKE=1` (never in production): the scripted model for CI/E2E.
 * - `OPENCMO_AGENT_PROVIDER=anthropic|gemini`: the default for new chats.
 * - Unset: Claude when the server has an Anthropic key, otherwise Gemini.
 *
 * A session is bound to its model family (native history): `providerForModel` rebuilds that
 * provider, or returns null when the server has no key for it any more.
 */

import { resolveAgent, type AgentId } from "@/lib/cmo/agents/registry";

import { ANTHROPIC_MODEL, anthropicFormat, anthropicProvider } from "./providers/anthropic";
import { fakeProvider } from "./providers/fake";
import { GEMINI_MODEL, geminiKey, geminiProvider } from "./providers/gemini";
import { geminiFormat } from "./providers/gemini-history";
import type { Format, Provider, ProviderKind } from "./providers/types";
import { isProduction } from "@/lib/production";

function fakeAllowed(): boolean {
  return process.env.OPENCMO_AGENT_FAKE === "1" && !isProduction();
}

const hasAnthropicKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Provider for a NEW session, or null when the Assistant is not set up. */
export function agentProvider(): Provider | null {
  if (fakeAllowed()) return fakeProvider;
  const wanted = process.env.OPENCMO_AGENT_PROVIDER?.trim().toLowerCase();
  if (wanted === "gemini") return geminiKey() ? geminiProvider(geminiKey()) : null;
  if (wanted === "anthropic") return hasAnthropicKey() ? anthropicProvider() : null;
  if (hasAnthropicKey()) return anthropicProvider();
  return geminiKey() ? geminiProvider(geminiKey()) : null;
}

/**
 * Provider for a CMO agent that chats (H1): model and key come from the agent registry
 * (`CMO_AGENT_<ID>_*`), not from the editor Assistant. Null when the agent has no key.
 */
export function agentChatProvider(id: AgentId): Provider | null {
  if (fakeAllowed()) return fakeProvider;
  const agent = resolveAgent(id);
  if (!agent.apiKey) return null;
  return agent.provider === "gemini" ? geminiProvider(agent.apiKey, undefined, agent.model) : anthropicProvider(agent.model, agent.apiKey);
}

/** Provider family of a saved model id. */
export const kindOf = (model: string): ProviderKind =>
  model === "fake" ? "fake" : model.startsWith("gemini") ? "gemini" : "anthropic";

/** History format of a session — needs no key, used to draw the panel. */
export const formatFor = (model: string): Format =>
  kindOf(model) === "gemini" ? geminiFormat : { kind: kindOf(model), ...anthropicFormat };

/** Provider to continue an existing session; null when the server cannot run it any more. */
export function providerForModel(model: string): Provider | null {
  switch (kindOf(model)) {
    case "fake":
      return fakeAllowed() ? fakeProvider : null;
    case "gemini":
      // A saved id may be the exact version `modelVersion` reported; the chat continues on the
      // configured Gemini model — same family, same history format.
      return geminiKey() ? geminiProvider(geminiKey()) : null;
    default:
      return hasAnthropicKey() && model === ANTHROPIC_MODEL ? anthropicProvider() : null;
  }
}

/** Models the panel can offer (only those the server has a key for), default first. */
export function availableModels(): { id: string; label: string }[] {
  if (fakeAllowed()) return [{ id: "fake", label: "Test model" }];
  const out: { id: string; label: string }[] = [];
  if (hasAnthropicKey()) out.push({ id: ANTHROPIC_MODEL, label: "Claude Sonnet 5.5" });
  if (geminiKey()) out.push({ id: GEMINI_MODEL, label: "Gemini Pro" });
  // The default (`agentProvider`) goes first.
  const preferred = agentProvider()?.model;
  return out.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
}
