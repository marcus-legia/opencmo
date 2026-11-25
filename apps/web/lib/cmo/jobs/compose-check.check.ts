/**
 * The Composer's AI check (plan 2026-11-25, Part L):
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/jobs/compose-check.check.ts
 */
import assert from "node:assert/strict";

process.env.OPENCMO_AGENT_FAKE = "1";

import type { ComposeCheckOutput } from "../../composer/types";
import { keepIssues } from "./compose-check";
import { memoryStore } from "./memory-store";
import { drainCmoQueue } from "./runner";
import type { Documents } from "./types";

async function main() {
  // A flag whose quote is not in the post is dropped (Review Focus 2); a whole-post flag (empty quote) stays.
  const post = { title: "How do you turn a reply into a customer?", body: "I built  a SaaS.\nMy revenue is flat." };
  const kept = keepIssues(
    [
      { quote: "I built a SaaS.", field: "body", rule: "Rule 3", severity: "warn", why: "w", suggestion: null },
      { quote: "We grew 300%", field: "body", rule: "No AI slop", severity: "block", why: "w", suggestion: null },
      { quote: "turn a reply", field: "body", rule: "Rule 1", severity: "warn", why: "in the title, not the body", suggestion: null },
      { quote: "", field: "body", rule: "Length", severity: "warn", why: "w", suggestion: null },
    ],
    post,
  );
  assert.deepEqual(kept.map((i) => i.rule), ["Rule 3", "Length"], "whitespace and case do not matter; invented quotes and wrong fields are dropped");
  assert.ok(kept.every((i) => i.source === "ai"));

  // The job end to end on the fake model: the sub's rules are read (the freelance fixture plants an instruction),
  // the link and the product name are flagged, nothing is written.
  const docs: Documents = { product: { name: "Paylane", one_liner: "Invoicing that chases late payments." }, strategy: {}, brand: {}, post_plan: {} };
  const mem = memoryStore(docs);
  const run = mem.enqueue("compose_check", { platform: "reddit", subreddit: "r/freelance", title: "Late invoices", body: "I made Paylane for this. See https://paylane.example" }, 1);
  await drainCmoQueue(mem.store);
  assert.equal(run.status, "done", String(run.error));
  const out = run.output as unknown as ComposeCheckOutput;
  assert.equal(out.verdict, "fix");
  assert.deepEqual(out.issues.map((i) => i.rule).sort(), ["Disclosure", "Links"]);
  assert.ok(!JSON.stringify(out).includes("example.com"), "the planted instruction in the rules changes nothing (Review Focus 1)");

  // No body, or no subreddit for Reddit: the run fails (and its credit comes back), with a line the founder can act on.
  const empty = mem.enqueue("compose_check", { platform: "reddit", subreddit: "SaaS", body: " " }, 1);
  const nosub = mem.enqueue("compose_check", { platform: "reddit", body: "Hello" }, 1);
  await drainCmoQueue(mem.store);
  assert.equal(empty.status, "failed");
  assert.equal(empty.error, "Write the post first, then check it.");
  assert.equal(nosub.error, "Pick the subreddit you will post in.");

  // X: no subreddit needed.
  const x = mem.enqueue("compose_check", { platform: "x", body: "Most late invoices are a reminder problem." }, 1);
  await drainCmoQueue(mem.store);
  assert.equal(x.status, "done", String(x.error));
  assert.equal((x.output as unknown as ComposeCheckOutput).verdict, "ok");
  console.log("compose-check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
