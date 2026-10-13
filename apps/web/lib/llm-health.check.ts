/**
 * Provider health and failover, offline: which errors mean "this provider cannot answer now",
 * how long it is skipped, and that a call moves to the next provider only for those errors.
 *
 *     tsx lib/llm-health.check.ts
 */
import assert from "node:assert/strict";

import Anthropic from "@anthropic-ai/sdk";
import { ApiError } from "@google/genai";

import { clearHealth, isDown, markDown, outage, withFailover } from "./llm-health";

const anthropicError = (status: number, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, message, new Headers());

// ---------------------------------------------------------------- which errors
assert.equal(outage(anthropicError(400, "Your credit balance is too low to access the Anthropic API.")), "account", "out of credit");
assert.equal(outage(anthropicError(401, "invalid x-api-key")), "account");
assert.equal(outage(anthropicError(403, "forbidden")), "account");
assert.equal(outage(anthropicError(429, "rate limited")), "busy");
assert.equal(outage(anthropicError(529, "overloaded")), "busy");
assert.equal(outage(new Anthropic.APIConnectionError({ message: "socket hang up" })), "busy");
assert.equal(outage(anthropicError(400, "messages: text content blocks must be non-empty")), null, "a bad request is ours, not an outage");
// A timeout belongs to the request (a long prompt, a short limit): running it again elsewhere
// would double its time and cost, and one slow request must not move everyone off the provider.
assert.equal(outage(new Anthropic.APIConnectionTimeoutError()), null);
assert.equal(outage(new ApiError({ status: 429, message: "quota" })), "busy");
assert.equal(outage(new ApiError({ status: 503, message: "unavailable" })), "busy");
assert.equal(outage(new ApiError({ status: 403, message: "permission denied" })), "account");
assert.equal(outage(new ApiError({ status: 400, message: "API key not valid. Please pass a valid API key." })), "account");
assert.equal(outage(new ApiError({ status: 400, message: "Invalid JSON payload" })), null);
assert.equal(outage(new Error("anything else")), null);

// ---------------------------------------------------------------- how long, and for which model
clearHealth();
markDown("anthropic", "account", "claude-sonnet-5-5", 1_000);
assert.equal(isDown("anthropic", "claude-sonnet-5-5", 1_000 + 9 * 60_000), true, "an account problem is remembered for ten minutes");
assert.equal(isDown("anthropic", "claude-haiku-5-5", 1_000 + 9 * 60_000), true, "the key or its credit: every model of the provider");
assert.equal(isDown("anthropic", "claude-sonnet-5-5", 1_000 + 11 * 60_000), false);
assert.equal(isDown("gemini", "gemini-pro-latest", 2_000), false);
markDown("gemini", "busy", "gemini-pro-latest", 1_000);
assert.equal(isDown("gemini", "gemini-pro-latest", 1_000 + 30_000), true);
assert.equal(isDown("gemini", "gemini-flash-latest", 1_000 + 30_000), false, "one busy model says nothing about another");
assert.equal(isDown("gemini", "gemini-pro-latest", 1_000 + 90_000), false, "a busy model is retried after a minute");

async function main(): Promise<void> {
  // ---------------------------------------------------------------- failover
  type Agent = { provider: "anthropic" | "gemini"; model: string };
  const both: Agent[] = [{ provider: "anthropic", model: "claude-sonnet-5-5" }, { provider: "gemini", model: "gemini-pro-latest" }];

  clearHealth();
  let tried: string[] = [];
  const credit = anthropicError(400, "Your credit balance is too low");
  const answer = await withFailover(both, async (agent) => {
    tried.push(agent.provider);
    if (agent.provider === "anthropic") throw credit;
    return "from gemini";
  });
  assert.equal(answer, "from gemini");
  assert.deepEqual(tried, ["anthropic", "gemini"]);
  assert.equal(isDown("anthropic", "claude-sonnet-5-5"), true, "the failed provider is remembered");

  // While it is down, the next call starts with the healthy one.
  tried = [];
  await withFailover(both, async (agent) => void tried.push(agent.provider));
  assert.deepEqual(tried, ["gemini"]);

  // An error that is not an outage is not retried elsewhere: it is the caller's to report.
  clearHealth();
  tried = [];
  const bad = new Error("schema mismatch");
  await assert.rejects(withFailover(both, async (agent) => { tried.push(agent.provider); throw bad; }), (error) => error === bad);
  assert.deepEqual(tried, ["anthropic"]);

  // Every provider out: the first provider's error comes back (what the user's configuration meant).
  clearHealth();
  await assert.rejects(withFailover(both, async (agent) => { throw agent.provider === "anthropic" ? credit : new ApiError({ status: 503, message: "down" }); }), (error) => error === credit);

  // Both marked down: still try, in the configured order.
  tried = [];
  await withFailover(both, async (agent) => void tried.push(agent.provider));
  assert.deepEqual(tried, ["anthropic"]);

  // A candidate running on its own key (one agent's, not the server's) still fails over, but its
  // failure says nothing about the shared key: the provider is not marked down for everyone.
  clearHealth();
  type Keyed = Agent & { ownKey?: boolean };
  const keyed: Keyed[] = [{ provider: "anthropic", model: "claude-sonnet-5-5", ownKey: true }, { provider: "gemini", model: "gemini-pro-latest" }];
  assert.equal(await withFailover(keyed, async (agent) => { if (agent.provider === "anthropic") throw credit; return "ok"; }, (agent) => !agent.ownKey), "ok");
  assert.equal(isDown("anthropic", "claude-sonnet-5-5"), false);

  // One provider only: no failover, the error passes through.
  clearHealth();
  await assert.rejects(withFailover([both[0]!], async () => { throw credit; }), (error) => error === credit);

  console.log("llm health: outages, durations and failover correct");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
