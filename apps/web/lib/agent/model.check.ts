/**
 * Which provider an Assistant chat runs on: Claude only (owner, 2026-11-05).
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/agent/model.check.ts
 */
import assert from "node:assert/strict";

import { clearHealth, markDown } from "../llm-health";
import { agentChatProvider, agentProvider, assistantDown, availableModels, formatFor, kindOf, providerForModel } from "./model";
import { ANTHROPIC_MODEL } from "./providers/anthropic";

const env = process.env as Record<string, string | undefined>;
for (const key of ["OPENCMO_AGENT_FAKE", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY"]) delete env[key];

assert.equal(agentProvider(), null, "no key: the Assistant is not set up");
assert.deepEqual(availableModels(), []);
env.GEMINI_API_KEY = "g";
env.GROQ_API_KEY = "q";
assert.equal(agentProvider(), null, "another vendor's key does not set it up");
assert.equal(agentChatProvider("cmo"), null);

env.ANTHROPIC_API_KEY = "a";
assert.equal(agentProvider()!.kind, "anthropic");
assert.deepEqual(availableModels().map((model) => model.label), ["Claude Sonnet 5.5"], "one model to offer");

// Claude out of credit: still Claude (nothing else to run on); the panel can say it is down.
clearHealth();
markDown("anthropic", "account", "claude-sonnet-5-5");
assert.equal(agentProvider()!.kind, "anthropic");
assert.equal(assistantDown(ANTHROPIC_MODEL), true);
clearHealth();
assert.equal(assistantDown(ANTHROPIC_MODEL), false);

// A chat continues only on the model it started on; a chat from the removed Gemini cannot.
assert.equal(providerForModel(ANTHROPIC_MODEL)!.kind, "anthropic");
assert.equal(providerForModel("claude-sonnet-4-5"), null, "an older Claude id: start a new chat");
assert.equal(providerForModel("gemini-pro-latest"), null);
assert.equal(kindOf("gemini-3.1-pro-preview"), "retired");
assert.equal(formatFor("gemini-pro-latest").kind, "anthropic", "an old chat is drawn without a Gemini reader");

// The CMO chat runs on the `cmo` agent of the registry, on its own key when it has one.
assert.equal(agentChatProvider("cmo")!.model, "claude-sonnet-5-5");
env.CMO_AGENT_CMO_API_KEY = "own";
assert.equal(agentChatProvider("cmo")!.ownKey, true);
delete env.CMO_AGENT_CMO_API_KEY;

console.log("agent model: Claude only, chats bound to their model");
