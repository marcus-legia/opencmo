/**
 * The no-ai-slop gate (owner, 2026-11-12): the drafts from production that read as AI are refused, plain posts pass,
 * and a pattern the founder's own writing uses passes for them.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/slop.check.ts
 */
import assert from "node:assert/strict";

import { checkPost } from "./jobs/check-post";
import { memoryStore } from "./jobs/memory-store";
import { threadIssues } from "./jobs/draft-thread";
import { postProfile } from "./jobs/draft-post";
import { founderPatterns, slopIssues, slopPatterns } from "./slop";
import { writerMemory } from "./writer/context";

// Lines the writer and the planner produced on 2026-11-11.
const seen: [string, string][] = [
  ["Why manual approval is the secret to AI marketing", "headline"],
  ["The hidden $1,000/month cost of juggling freelancers and tools vs $60 with OpenCMO", "headline"],
  ["The danger of automated DMs and likes – why human-approved AI beats bots", "dash"],
  ["OpenCMO is one inbox with three departments. Nothing goes out until you approve it. Which department would you open first?", "closing_question"],
  ["This is a game changer for founders.", "hype"],
  ["The question isn't the model. It's the eval.", "binary_contrast"],
  ["Here's why we approve every draft by hand.", "headline"],
];
for (const [text, pattern] of seen) assert.ok((slopPatterns(text) as string[]).includes(pattern), `${pattern}: ${text}`);

// Plain posts pass.
for (const clean of [
  "We approve every draft by hand before it goes out. Last week that caught two posts with numbers we never had.",
  "Day 3 is when the first reminder goes out. Most invoices get paid by day 7.",
  "What should a solo founder post on a Monday?",
  "We moved the app to Next.js and Node.js.",
]) assert.deepEqual(slopPatterns(clean), [], clean);

// The fix the writer reads names the pattern and what to do instead.
assert.match(slopIssues("Which one would you pick? I know. Which one would you pick?")[0] ?? "", /question/);
assert.match(slopIssues("We ship daily — and it shows.")[0]!, /em dash/);

// A post check refuses them unless the founder's own writing uses the pattern.
const rules = { avoid: [], known: new Set<string>(), names: [] };
assert.ok(checkPost("We ship daily — every day.", rules).some((issue) => /em dash/.test(issue)));
assert.deepEqual(checkPost("We ship daily — every day.", { ...rules, allowSlop: founderPatterns(["I write fast — always have."]) }), []);

// Inside a thread a question leads on; only the last post must not bait replies.
const x = postProfile("X");
const thread = ["We approve every draft by hand.", "It takes ten minutes. Why bother?", "Last week it caught two posts with numbers we never had.", "So the check stays.", "Next week we time it again. Will it hold?"];
const issues = threadIssues(thread, x, rules);
assert.deepEqual(issues.filter((issue) => /question/.test(issue)).map((issue) => issue.slice(0, 7)), ["Post 5:"], "only the last post's closing question is refused");

// Voice: a draft approved as written is not the founder's writing; edits are.
async function voice(): Promise<void> {
  const { store, voice } = memoryStore({});
  const notes = [
    { body: 'Approved as written on X: "The secret to growth — consistency."', platform: "x", created_at: "2026-11-10T00:00:00Z", weight: 1, source: "approved" },
    { body: 'Edited on X before approving: "I write fast — always have."', platform: "x", created_at: "2026-11-09T00:00:00Z", weight: 0.9, source: "edited" },
    { body: 'Skipped a draft on X: "Too salesy"', platform: "x", created_at: "2026-11-08T00:00:00Z", weight: 0.8, source: "skipped" },
  ];
  voice.push(...notes);
  const memory = await writerMemory(store, "u");
  assert.deepEqual(memory.voiceNotes.map((note) => note.body.slice(0, 7)), ["Edited ", "Skipped"], "approved-as-written notes are dropped");
  assert.deepEqual([...memory.allowSlop!], ["em_dash"], "the founder's edit lets their em dash through; the approved draft's headline does not count");
}

voice().then(() => console.log("slop.check: gate, founder patterns and voice ok"), (error) => {
  console.error(error);
  process.exit(1);
});
