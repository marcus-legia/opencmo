/**
 * Which provider a new Assistant chat gets: the configured default, and the other one while the
 * default cannot answer.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/model.check.ts
 */
import assert from "node:assert/strict";

import { clearHealth, markDown } from "../llm-health";
import { agentProvider, availableModels, canSwitchFrom, providerForModel } from "./model";
import { geminiFormat } from "./providers/gemini-history";

const env = process.env as Record<string, string | undefined>;
for (const key of ["OPENCMO_AGENT_FAKE", "OPENCMO_AGENT_PROVIDER", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete env[key];

assert.equal(agentProvider(), null, "no key: the Assistant is not set up");

env.GEMINI_API_KEY = "g";
assert.equal(agentProvider()!.kind, "gemini", "only a Gemini key: Gemini");
env.ANTHROPIC_API_KEY = "a";
assert.equal(agentProvider()!.kind, "anthropic", "both keys: Claude by default");
assert.deepEqual(availableModels().map((model) => model.label), ["Claude Sonnet 5.5", "Gemini Pro"]);
env.OPENCMO_AGENT_PROVIDER = "gemini";
assert.equal(agentProvider()!.kind, "gemini", "the configured default wins");
assert.equal(availableModels()[0]!.label, "Gemini Pro", "the default is listed first");
delete env.OPENCMO_AGENT_PROVIDER;

// Claude cannot answer (no credit): new chats start on Gemini, and a failed Claude chat can say so.
clearHealth();
markDown("anthropic", "account", "claude-sonnet-5-5");
assert.equal(agentProvider()!.kind, "gemini");
assert.equal(availableModels()[0]!.label, "Gemini Pro");
assert.equal(canSwitchFrom("anthropic"), true);
assert.equal(canSwitchFrom("gemini"), false, "the other provider is down: nowhere to switch");
// A chat that exists stays on its own model: its history is in that provider's format.
assert.equal(providerForModel("gemini-3.1-pro-preview")!.kind, "gemini");

// A busy Haiku (the checking tier) says nothing about the Assistant's model.
clearHealth();
markDown("anthropic", "busy", "claude-haiku-5-5");
assert.equal(agentProvider()!.kind, "anthropic");
markDown("anthropic", "account", "claude-haiku-5-5");

// Both down: the configured default is tried anyway.
markDown("gemini", "busy", "gemini-pro-latest");
assert.equal(agentProvider()!.kind, "anthropic");
assert.equal(canSwitchFrom("anthropic"), false);

// One key only: nothing to switch to.
clearHealth();
delete env.GEMINI_API_KEY;
markDown("anthropic", "account", "claude-sonnet-5-5");
assert.equal(agentProvider()!.kind, "anthropic");
assert.equal(canSwitchFrom("anthropic"), false);

// Unanswered calls of a Gemini history: only ids Gemini set can name a stored result.
const history = [
  { role: "user" as const, content: [{ text: "hi" }] },
  { role: "assistant" as const, content: [{ functionCall: { id: "call_1", name: "a", args: {} } }, { functionCall: { name: "b", args: {} } }, { functionCall: { id: "call_3", name: "c", args: {} } }] },
  { role: "user" as const, content: geminiFormat.toolResults([{ id: "call_1", name: "a", ok: true, content: "{}" }]) },
];
assert.deepEqual(geminiFormat.danglingCalls(history), ["call_3"]);
assert.deepEqual(geminiFormat.danglingCalls(history.slice(0, 1)), []);

console.log("agent model: default, configured and failover providers correct");
