/**
 * Writer for every platform (P3 W1): the fixture's brief as a Threads item and a LinkedIn item, each drafted by
 * `post_draft` for its profile. Every version passes the profile's code checks (limit, no links, no hashtags) and
 * then the judge; a code-only `style-N` result counts No AI Slop's stock patterns, measured, never a gate.
 *
 *   w2-threads, w2-linkedin — finished; three versions graded like W2
 */

import type { CaseResult } from "@/lib/eval/compare";

import { profileOf } from "../../../platforms";
import { checkPostFor } from "../../../writer/checks";
import { avoidList, knownNumbers } from "../../context";
import { cascade } from "../../judge";
import { memoryStore } from "../../memory-store";
import { isoDay, type ItemRow } from "../../types";
import { stockPatterns } from "../style";
import { registerCases, type EvalCase } from "../types";

const BUDGET_MS = 240_000;
const PLATFORMS = ["threads", "linkedin"] as const;

const item = (platform: string, idea: string): ItemRow => ({
  id: `eval-${platform}`,
  run_id: null,
  department: "post",
  platform,
  day: isoDay(),
  idea,
  reason: "From the content strategy",
  status: "planned",
  priority: "medium",
  body: {},
  final_text: null,
  external_url: null,
  decided_at: null,
  published_at: null,
  created_at: new Date().toISOString(),
});

/** One case per platform, so each has its own row and `--job` can pick it. */
function platformCase(platform: (typeof PLATFORMS)[number]): EvalCase {
  const job = `w2-${platform}`;
  return {
    job,
    async run(fixture, env) {
      const profile = profileOf(platform)!;
      const rules = { avoid: avoidList(fixture.docs), known: knownNumbers(fixture.docs) };
      const mem = memoryStore(fixture.docs, []);
      const row = item(platform, fixture.brief);
      mem.items.push(row);
      const run = mem.enqueue("post_draft", { item_id: row.id });
      await env.drain(mem.store, { runId: run.id, budgetMs: BUDGET_MS });
      const drafted = mem.items.find((i) => i.id === row.id);
      if (drafted?.body.gen) env.recordGen(job, drafted.body.gen);
      const texts = drafted?.status === "in_review" ? [String(drafted.body.text ?? ""), ...((drafted.body.alternates as string[] | undefined) ?? [])] : [];
      const results: CaseResult[] = [{ id: `${job}:${fixture.name}:run`, epoch: env.epoch, pass: run.status === "done", decided_by: "code", ...(run.error ? { notes: [run.error] } : {}) }];
      // Always three outputs, so a run that drafted fewer pairs as fails, not as missing cases.
      for (let index = 0; index < 3; index++) {
        const text = texts[index] ?? "";
        env.log(`[${index + 1}] ${text}`);
        const issues = text ? checkPostFor(text, profile, rules) : ["no draft"];
        results.push(await cascade(`${job}:${fixture.name}:${index}`, env.epoch, issues, env.judge, { job: `A ${profile.label} post for the founder on: ${fixture.brief}`, docs: fixture.docs, output: text }));
        const patterns = text ? stockPatterns(text) : [];
        results.push({ id: `${job}:${fixture.name}:style-${index}`, epoch: env.epoch, pass: Boolean(text) && patterns.length === 0, decided_by: "code", ...(patterns.length ? { notes: patterns } : text ? {} : { notes: ["no draft"] }) });
      }
      return results;
    },
  };
}

export const platformPostCases = PLATFORMS.map(platformCase);

registerCases(platformPostCases);
