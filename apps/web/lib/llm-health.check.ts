/**
 * Claude's health, offline: which errors mean "Claude cannot answer now", how long that is remembered,
 * and that only those errors are remembered.
 *
 *     tsx lib/llm-health.check.ts
 */
import assert from "node:assert/strict";

import Anthropic from "@anthropic-ai/sdk";

import { accountDown, clearHealth, healthyFirst, isDown, markDown, outage, withFailover } from "./llm-health";

const anthropicError = (status: number, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, message, new Headers());

// ---------------------------------------------------------------- which errors
assert.equal(outage(anthropicError(400, "Your credit balance is too low to access the Anthropic API.")), "account", "out of credit");
assert.equal(outage(anthropicError(401, "invalid x-api-key")), "account");
assert.equal(outage(anthropicError(403, "forbidden")), "account");
assert.equal(outage(anthropicError(429, "rate limited")), "busy");
assert.equal(outage(anthropicError(529, "overloaded")), "busy");
assert.equal(outage(new Anthropic.APIConnectionError({ message: "socket hang up" })), "busy");
assert.equal(outage(anthropicError(400, "messages: text content blocks must be non-empty")), null, "a bad request is ours, not an outage");
// A timeout belongs to the request (a long prompt, a short limit), not to Claude.
assert.equal(outage(new Anthropic.APIConnectionTimeoutError()), null);
assert.equal(outage(new Error("anything else")), null);

// ---------------------------------------------------------------- how long, and for which model
clearHealth();
markDown("anthropic", "account", "claude-sonnet-5-5", 1_000);
assert.equal(isDown("anthropic", "claude-sonnet-5-5", 1_000 + 9 * 60_000), true, "an account problem is remembered for ten minutes");
assert.equal(isDown("anthropic", "claude-haiku-5-5", 1_000 + 9 * 60_000), true, "the key or its credit: every model");
assert.equal(accountDown("anthropic", 1_000 + 9 * 60_000), true);
assert.equal(isDown("anthropic", "claude-sonnet-5-5", 1_000 + 11 * 60_000), false);
clearHealth();
markDown("anthropic", "busy", "claude-sonnet-5-5", 1_000);
assert.equal(isDown("anthropic", "claude-sonnet-5-5", 1_000 + 30_000), true);
assert.equal(isDown("anthropic", "claude-haiku-5-5", 1_000 + 30_000), false, "one busy model says nothing about another");
assert.equal(accountDown("anthropic", 1_000 + 30_000), false, "busy is not an account outage");
assert.equal(isDown("anthropic", "claude-sonnet-5-5", 1_000 + 90_000), false, "a busy model is retried after a minute");

async function main(): Promise<void> {
  type Agent = { provider: "anthropic"; model: string; ownKey?: boolean };
  const sonnet: Agent[] = [{ provider: "anthropic", model: "claude-sonnet-5-5" }];
  const credit = anthropicError(400, "Your credit balance is too low");

  // An outage passes through and is remembered for the next caller.
  clearHealth();
  await assert.rejects(withFailover(sonnet, async () => { throw credit; }), (error) => error === credit);
  assert.equal(accountDown("anthropic"), true, "the failed key is remembered");

  // Down: still tried (there is nothing else to run on).
  let tried = 0;
  await withFailover(sonnet, async () => void tried++);
  assert.equal(tried, 1);

  // An error that is not an outage is the caller's to report, and is not remembered.
  clearHealth();
  const bad = new Error("schema mismatch");
  await assert.rejects(withFailover(sonnet, async () => { throw bad; }), (error) => error === bad);
  assert.equal(isDown("anthropic", "claude-sonnet-5-5"), false);

  // An agent on its own key: its failure says nothing about the shared key.
  clearHealth();
  const own: Agent[] = [{ provider: "anthropic", model: "claude-sonnet-5-5", ownKey: true }];
  await assert.rejects(withFailover(own, async () => { throw credit; }, (agent) => !agent.ownKey));
  assert.equal(accountDown("anthropic"), false);
  markDown("anthropic", "account", "claude-sonnet-5-5");
  assert.equal(healthyFirst(own, (agent) => !agent.ownKey).length, 1, "its own key still runs");

  console.log("llm health: outages and durations correct");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
