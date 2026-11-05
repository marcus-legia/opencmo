/**
 * Prompt screening, offline (owner decision D8: moderation is Creem's): a fake fetch stands in for Creem's
 * Moderation API and answers each decision; no LLM is asked about a prompt.
 *
 *     NODE_OPTIONS=--conditions=react-server tsx lib/generate/moderation.check.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ApiError } from "@/lib/api/errors";

import * as moderation from "./moderation";
import { BLOCKED_MESSAGE, creemModerationKey, FAKE_FLAG, moderateText, moderationKind, moderationReady, MOTION_KIND, specText } from "./moderation";

type Call = { url: string; body: { prompt?: string; external_id?: string } };

function creem(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Call["body"] });
    return answer();
  }) as typeof fetch;
  return { fetcher, calls };
}
const decide = (decision: string) => () => Response.json({ decision, usage: { units: 1 } });

/** The HTTP status the user would get: 200 when allowed, else the error's status, or the block message. */
async function run(text: string, kind: string | undefined, fetcher: typeof fetch): Promise<number | string> {
  try {
    await moderateText(text, { ...(kind ? { kind } : {}), externalId: "job_1", fetcher });
    return 200;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    return err.status === 422 ? err.message : err.status;
  }
}

const saved = { key: process.env.CREEM_API_KEY, env: process.env.OPENCMO_ENV, vercel: process.env.VERCEL_ENV, fake: process.env.OPENCMO_AI_FAKE };
function restore() {
  for (const [name, value] of [["CREEM_API_KEY", saved.key], ["OPENCMO_ENV", saved.env], ["VERCEL_ENV", saved.vercel], ["OPENCMO_AI_FAKE", saved.fake]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function main(): Promise<void> {
  // We write no policy of our own: nothing of the kind is exported, and no model client is imported.
  for (const name of ["POLICY", "AUDIO_POLICY", "MOTION_POLICY", "policyFor", "verdictSchema"]) assert.ok(!(name in moderation), `${name} is gone`);
  assert.doesNotMatch(readFileSync(new URL("./moderation.ts", import.meta.url), "utf8"), /@anthropic-ai\/sdk/, "no LLM screens prompts");

  // The output review the worker runs is Creem's words, quoted; the web and the worker read the same file.
  const policy = JSON.parse(readFileSync(new URL("../../../../packages/contracts/creem-policy.json", import.meta.url), "utf8")) as { policy: string };
  assert.match(policy.policy, /face-swap, deepfake, or face-manipulation/);
  assert.match(policy.policy, /sexually provocative/);
  assert.doesNotMatch(policy.policy, /real person|logo|brand|trademark/i, "no rule of ours on people or brands (D8)");

  try {
    delete process.env.OPENCMO_AI_FAKE;
    delete process.env.OPENCMO_ENV;
    delete process.env.VERCEL_ENV;
    process.env.CREEM_API_KEY = "creem_test_key";

    const allow = creem(decide("allow"));
    assert.equal(await run("a laptop on a desk at night", "image", allow.fetcher), 200);
    assert.equal(allow.calls[0]?.url, "https://test-api.creem.io/v1/moderation/prompt", "a test key goes to the sandbox");
    assert.deepEqual(allow.calls[0]?.body, { prompt: "a laptop on a desk at night", external_id: "job_1" });
    // A prompt that names a person or a brand is Creem's to judge, not ours.
    assert.equal(await run("our founder Marcus holding a Shopify mug", "image", allow.fetcher), 200);

    for (const decision of ["deny", "flag"]) {
      const blocked = creem(decide(decision));
      assert.equal(await run("anything", "video", blocked.fetcher), BLOCKED_MESSAGE, `${decision} blocks`);
    }
    assert.equal(await run("x y", "image", creem(decide("maybe")).fetcher), 503, "an unknown decision fails closed");
    assert.equal(await run("x y", "image", creem(() => new Response("no", { status: 500 })).fetcher), 503, "a 5xx fails closed");
    assert.equal(await run("x y", "image", creem(() => new Response("not json")).fetcher), 503, "an unreadable answer fails closed");
    assert.equal(await run("x y", "video", creem(() => Promise.reject(new DOMException("timed out", "TimeoutError"))).fetcher), 503, "a timeout fails closed");

    // Audio is outside Creem's scope and we add no check of our own; our renderer's text is screened like a video.
    const denied = creem(decide("deny"));
    assert.equal(await run("a calm voice-over", "voice", denied.fetcher), 200);
    assert.equal(await run("lo-fi beat", "audio", denied.fetcher), 200);
    assert.equal(denied.calls.length, 0, "audio never calls Creem");
    assert.equal(await run("Post drafts to X", MOTION_KIND, denied.fetcher), BLOCKED_MESSAGE, "motion text is screened");
    assert.equal(await run("anything", undefined, denied.fetcher), BLOCKED_MESSAGE, "an unknown kind is screened");

    // No key: skipped in dev, the fake mark blocks in fake mode, refused live; a test key never counts live.
    delete process.env.CREEM_API_KEY;
    const none = creem(decide("deny"));
    assert.equal(await run("a cat", "image", none.fetcher), 200, "without a key, outside production, nothing is screened");
    process.env.OPENCMO_AI_FAKE = "1";
    assert.equal(await run(`a cat ${FAKE_FLAG}`, "image", none.fetcher), BLOCKED_MESSAGE, "fake mode blocks the mark");
    assert.equal(none.calls.length, 0);
    delete process.env.OPENCMO_AI_FAKE;
    process.env.OPENCMO_ENV = "production";
    assert.equal(await run("a cat", "image", none.fetcher), 503, "live without a key: nothing is created");
    process.env.CREEM_API_KEY = "creem_test_key";
    assert.equal(await run("a cat", "image", none.fetcher), 503, "live with a test key: nothing is created");
    assert.equal(creemModerationKey(), null);
    process.env.CREEM_API_KEY = "creem_live_key";
    assert.equal(creemModerationKey(), "creem_live_key");
    const live = creem(decide("allow"));
    assert.equal(await run("a cat", "image", live.fetcher), 200);
    assert.equal(live.calls[0]?.url, "https://api.creem.io/v1/moderation/prompt", "a live key goes live");
  } finally {
    restore();
  }

  // The worker's output review needs the Anthropic key: production runs AI media only with it.
  const env = (extra: Record<string, string>) => ({ ...extra }) as NodeJS.ProcessEnv;
  assert.equal(moderationReady(env({ ANTHROPIC_API_KEY: "a" })), true);
  assert.equal(moderationReady(env({ GROQ_API_KEY: "q", GEMINI_API_KEY: "g" })), false, "other vendors' keys do not count");
  assert.equal(moderationReady(env({})), false);

  assert.equal(moderationKind({ kind: "video", provider: "opencmo-motion" }), MOTION_KIND);
  assert.equal(moderationKind({ kind: "video", provider: "fal" }), "video");
  assert.deepEqual(specText({ prompt: "a cat", model: "fal-veo", voice: "Aria", refs: ["x"], startAfter: "a".repeat(64) }), ["a cat"]);
  console.log("moderation: every check passed");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
