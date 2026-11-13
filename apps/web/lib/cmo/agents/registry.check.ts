/**
 * Checks the agent registry (H1): Claude per tier, per-agent env overrides, an agent's own key wins
 * over the shared key, and a missing key leaves `apiKey` empty. Run with
 * `NODE_OPTIONS=--conditions=react-server tsx …`.
 */

import assert from "node:assert/strict";

import { AGENT_IDS, agentCandidates, agentTable, resolveAgent } from "./registry";

const base = { ANTHROPIC_API_KEY: "a-shared" } as unknown as NodeJS.ProcessEnv;

// Default: Sonnet for drafting agents, Haiku for checking agents, the shared key.
const planner = resolveAgent("planner", base);
assert.equal(planner.provider, "anthropic");
assert.equal(planner.model, "claude-sonnet-5-5");
assert.equal(planner.apiKey, "a-shared");
assert.equal(planner.source, "default");
assert.equal(resolveAgent("checker", base).model, "claude-haiku-5-5");

// Per-agent override: model and key; other agents are unaffected.
const env = { ...base, CMO_AGENT_X_WRITER_MODEL: "claude-opus-5-5", CMO_AGENT_X_WRITER_API_KEY: "a-writer" } as unknown as NodeJS.ProcessEnv;
const writer = resolveAgent("x_writer", env);
assert.deepEqual([writer.model, writer.apiKey, writer.source], ["claude-opus-5-5", "a-writer", "env"]);
assert.equal(resolveAgent("planner", env).apiKey, "a-shared");
assert.deepEqual([writer.ownKey, resolveAgent("planner", env).ownKey], [true, false], "only the agent with its own key is marked");

// One provider (owner, 2026-11-05): other vendors' keys never make an agent leave Claude.
const others = { ...base, GEMINI_API_KEY: "g", GROQ_API_KEY: "q", OPENAI_COMPAT_API_KEY: "o", CMO_LLM_PROVIDER: "gemini", CMO_AGENT_SALES_PROVIDER: "groq" } as unknown as NodeJS.ProcessEnv;
for (const id of AGENT_IDS) {
  const agent = resolveAgent(id, others);
  assert.deepEqual([agent.provider, agent.apiKey], ["anthropic", "a-shared"], `${id} stays on Claude`);
  assert.ok(agent.model.startsWith("claude-"), `${id} runs a Claude model`);
}
assert.deepEqual(agentCandidates("planner", others).map((agent) => agent.model), ["claude-sonnet-5-5"], "one candidate");
assert.deepEqual(agentCandidates("planner", { GEMINI_API_KEY: "g" } as unknown as NodeJS.ProcessEnv), [], "no Anthropic key: not set up");

// The tiers the owner set: Sonnet writes and plans, Haiku does the small tasks.
for (const id of ["cmo", "onboarding", "planner", "x_writer", "brief_writer", "sales", "research", "motion", "director"] as const) assert.equal(resolveAgent(id, base).model, "claude-sonnet-5-5", `${id} on Sonnet`);
for (const id of ["checker", "captions", "writer", "moderation", "shorts"] as const) assert.equal(resolveAgent(id, base).model, "claude-haiku-5-5", `${id} on Haiku`);

// No key: empty (the caller reports it in English).
assert.equal(resolveAgent("cmo", {} as unknown as NodeJS.ProcessEnv).apiKey, "");

// The diagnostics table holds no keys.
const table = agentTable(env);
assert.equal(table.length, AGENT_IDS.length);
assert.ok(!JSON.stringify(table).includes("a-writer"));

console.log(`agent registry: ${AGENT_IDS.length} agents, env overrides correct`);
