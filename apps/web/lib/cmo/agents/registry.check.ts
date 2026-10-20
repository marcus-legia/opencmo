/**
 * Checks the agent registry (H1): Claude (or Gemini) per tier, per-agent env overrides, an agent's own key wins
 * over the shared key, and a missing key leaves `apiKey` empty. Run with
 * `NODE_OPTIONS=--conditions=react-server tsx …`.
 */

import assert from "node:assert/strict";

import { AGENT_IDS, agentCandidates, agentTable, GROQ_BASE_URL, otherProvider, providerOrder, resolveAgent } from "./registry";

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

// Gemini: per tier, its own shared key; CMO_LLM_PROVIDER moves every agent, a per-agent setting wins.
const both = { ...base, GEMINI_API_KEY: "g-shared" } as unknown as NodeJS.ProcessEnv;
assert.equal(resolveAgent("sales", both).provider, "anthropic", "a Gemini key alone does not switch provider");
const gemini = { ...both, CMO_LLM_PROVIDER: "gemini", CMO_AGENT_CHECKER_PROVIDER: "anthropic" } as unknown as NodeJS.ProcessEnv;
assert.deepEqual([resolveAgent("director", gemini).provider, resolveAgent("director", gemini).model, resolveAgent("director", gemini).apiKey], ["gemini", "gemini-pro-latest", "g-shared"]);
assert.equal(resolveAgent("writer", gemini).model, "gemini-flash-latest");
assert.deepEqual([resolveAgent("checker", gemini).provider, resolveAgent("checker", gemini).model], ["anthropic", "claude-haiku-5-5"]);
const errors = console.error;
console.error = () => undefined;
assert.equal(resolveAgent("cmo", { ...both, CMO_AGENT_CMO_PROVIDER: "mistral" } as unknown as NodeJS.ProcessEnv).provider, "anthropic", "an unknown provider falls back");
console.error = errors;

// Failover: the same agent on the other provider uses that provider's tier model and shared key,
// never the agent's own model id or key (they belong to the configured provider).
const own = { ...both, CMO_AGENT_DIRECTOR_MODEL: "claude-opus-5-5", CMO_AGENT_DIRECTOR_API_KEY: "a-director" } as unknown as NodeJS.ProcessEnv;
const fallback = resolveAgent("director", own, "gemini");
assert.deepEqual([fallback.provider, fallback.model, fallback.apiKey], ["gemini", "gemini-pro-latest", "g-shared"]);
assert.equal(resolveAgent("checker", base, "gemini").apiKey, "", "no key for the other provider: no failover");

// OpenAI-compatible (Groq by default): first in the default order once its key is set, per tier,
// its own endpoint per agent; `groq` is a spelling of it.
const groq = { ...both, GROQ_API_KEY: "q-shared" } as unknown as NodeJS.ProcessEnv;
const viaGroq = resolveAgent("planner", groq);
assert.deepEqual([viaGroq.provider, viaGroq.model, viaGroq.apiKey, viaGroq.baseUrl], ["openai", "openai/gpt-oss-120b", "q-shared", GROQ_BASE_URL]);
assert.equal(resolveAgent("checker", groq).model, "openai/gpt-oss-20b");
assert.equal(resolveAgent("moderation", groq).model, "openai/gpt-oss-20b", "moderation is a check-tier agent");
assert.equal(resolveAgent("checker", { ...groq, OPENAI_COMPAT_CHECK_MODEL: "llama-x" } as unknown as NodeJS.ProcessEnv).model, "llama-x");
assert.equal(resolveAgent("planner", base).baseUrl, "", "only openai has an endpoint");
const router = { ...groq, CMO_AGENT_SALES_PROVIDER: "groq", CMO_AGENT_SALES_BASE_URL: "https://openrouter.ai/api/v1/", CMO_AGENT_SALES_API_KEY: "r-sales" } as unknown as NodeJS.ProcessEnv;
assert.deepEqual([resolveAgent("sales", router).provider, resolveAgent("sales", router).baseUrl, resolveAgent("sales", router).ownKey], ["openai", "https://openrouter.ai/api/v1", true]);
assert.equal(resolveAgent("sales", router, "openai").baseUrl, GROQ_BASE_URL, "failover never uses one agent's own endpoint");

// The order: CMO_LLM_PROVIDERS first, the rest after; candidates only with a key, the configured one first.
assert.deepEqual(providerOrder({} as NodeJS.ProcessEnv), ["openai", "anthropic", "gemini"]);
assert.deepEqual(providerOrder({ CMO_LLM_PROVIDERS: "gemini, nope ,groq" } as unknown as NodeJS.ProcessEnv), ["gemini", "openai", "anthropic"]);
assert.deepEqual(agentCandidates("planner", groq).map((agent) => agent.provider), ["openai", "anthropic", "gemini"]);
assert.deepEqual(agentCandidates("planner", { ...groq, CMO_LLM_PROVIDERS: "gemini,anthropic" } as unknown as NodeJS.ProcessEnv).map((agent) => agent.provider), ["gemini", "anthropic", "openai"]);
assert.deepEqual(agentCandidates("planner", base).map((agent) => agent.provider), ["anthropic"], "no key: not a candidate");
assert.deepEqual(agentCandidates("planner", groq, "gemini").map((agent) => agent.provider), ["gemini", "openai", "anthropic"], "prefer goes first");
assert.equal(resolveAgent("planner", { GEMINI_API_KEY: "g" } as unknown as NodeJS.ProcessEnv).provider, "gemini", "the only key decides when nothing is named");
assert.equal(otherProvider("anthropic", groq), "openai");
assert.equal(otherProvider("openai", groq), "anthropic");
assert.deepEqual(agentCandidates("checker", base, otherProvider("anthropic", base)).map((agent) => agent.provider), ["anthropic"], "no other key: the same provider, separate context");

// No key: empty (the caller reports it in English).
assert.equal(resolveAgent("cmo", {} as unknown as NodeJS.ProcessEnv).apiKey, "");

// The diagnostics table holds no keys.
const table = agentTable(env);
assert.equal(table.length, AGENT_IDS.length);
assert.ok(!JSON.stringify(table).includes("a-writer"));

console.log(`agent registry: ${AGENT_IDS.length} agents, env overrides correct`);
