/**
 * The mode switch, offline: when the founder's Claude thinks instead of OpenCMO's models.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/cmo/brain.check.ts
 */
import assert from "node:assert/strict";

import { AGENT_HOLD_CREDITS } from "@/lib/agent/limits";
import { clearHealth, markDown } from "@/lib/llm-health";

import { decideBrain, providersUp } from "./brain";

assert.deepEqual(decideBrain({ credits: 100, providersUp: 2 }), { brain: "opencmo", reason: "ok", credits: 100 });
assert.equal(decideBrain({ credits: AGENT_HOLD_CREDITS, providersUp: 1 }).brain, "opencmo", "exactly one hold is enough");
assert.deepEqual(decideBrain({ credits: AGENT_HOLD_CREDITS - 1, providersUp: 2 }), { brain: "claude", reason: "credits", credits: AGENT_HOLD_CREDITS - 1 });
assert.equal(decideBrain({ credits: 500, providersUp: 0 }).reason, "llm_down", "no provider can answer: credits do not help");
assert.equal(decideBrain({ credits: 500, providersUp: 2, forced: true }).reason, "forced");

const env = { ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" } as unknown as NodeJS.ProcessEnv;
clearHealth();
assert.equal(providersUp(env), 2);
assert.equal(providersUp({ ANTHROPIC_API_KEY: "a" } as unknown as NodeJS.ProcessEnv), 1, "a missing key is a provider down");
assert.equal(providersUp({} as NodeJS.ProcessEnv), 0);
markDown("anthropic", "account", "claude-sonnet-5-5");
assert.equal(providersUp(env), 1, "a key out of credit takes its provider down");
markDown("gemini", "busy", "gemini-pro-latest");
assert.equal(providersUp(env), 1, "a busy model is not an account outage");
markDown("gemini", "account", "gemini-pro-latest");
assert.equal(providersUp(env), 0, "both accounts down");
assert.equal(providersUp(env, Date.now() + 11 * 60_000), 2, "and back once the skip window passes");
clearHealth();

console.log("brain.check — mode switch: credits, provider accounts, busy is not down.");
