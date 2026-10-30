/**
 * Writer for every platform (P3 W1): the fixture's brief as a Threads item and a LinkedIn item, each drafted by
 * `post_draft` for its profile. Every version passes the profile's code checks (limit, no links, no hashtags) and
 * then the judge; a code-only `style-N` result counts No AI Slop's stock patterns, measured, never a gate.
 *
 *   w2-threads, w2-linkedin — finished; three versions graded like W2
 *   w3-brief   — `write_video_brief` from the fixture's brief: Studio's type, three hooks, facts from the documents;
 *                then the judge
 *   w3-caption — `write_caption` for one short whose words are the fixture's brief, on every caption profile: the
 *                profile's rules as `cmo_save_caption` holds them, then the judge, plus the style measure
 */

import type { CaseResult } from "@/lib/eval/compare";

import { CAPTION_PROFILES, countHashtags, profileOf } from "../../../platforms";
import { checkPostFor, checkVideoBrief } from "../../../writer/checks";
import { VideoBriefSchema } from "../../../writer/types";
import { checkRules } from "../../context";
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
      const rules = checkRules(fixture.docs);
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

const briefCase: EvalCase = {
  job: "w3-brief",
  async run(fixture, env) {
    const mem = memoryStore(fixture.docs, []);
    const run = mem.enqueue("write_video_brief", { order_id: "eval-brief", idea: fixture.brief, reason: "From the content strategy", seconds: 30, aspect: "9:16" });
    await env.drain(mem.store, { runId: run.id, budgetMs: BUDGET_MS });
    const parsed = VideoBriefSchema.safeParse((run.output as { brief?: unknown } | null)?.brief);
    const results: CaseResult[] = [{ id: `w3-brief:${fixture.name}:run`, epoch: env.epoch, pass: run.status === "done", decided_by: "code", ...(run.error ? { notes: [run.error] } : {}) }];
    const rules = checkRules(fixture.docs);
    const issues = parsed.success ? checkVideoBrief(parsed.data, rules) : ["no brief"];
    const text = parsed.success ? [`Objective: ${parsed.data.objective}`, `Hooks: ${parsed.data.hooks.join(" | ")}`, `Key points: ${parsed.data.keyPoints.join(" | ")}`, `Call to action: ${parsed.data.cta}`].join("\n") : "";
    env.log(text);
    results.push(await cascade(`w3-brief:${fixture.name}:brief`, env.epoch, issues, env.judge, { job: `The brief a short video about "${fixture.brief}" is made from: three hooks, facts from the documents, one call to action`, docs: fixture.docs, output: text }));
    return results;
  },
};

const captionCase: EvalCase = {
  job: "w3-caption",
  async run(fixture, env) {
    const mem = memoryStore(fixture.docs, []);
    mem.videos.push({ clipId: "eval-short", kind: "short", title: fixture.brief.slice(0, 60), hook: `${fixture.brief}.`, transcript: `${fixture.brief}. That is what this short shows, from the founder's own screen.`, seconds: 30 });
    const run = mem.enqueue("write_caption", { order_id: "eval-caption", clip_ids: ["eval-short"], profiles: CAPTION_PROFILES.map((p) => p.id) });
    await env.drain(mem.store, { runId: run.id, budgetMs: BUDGET_MS });
    const results: CaseResult[] = [{ id: `w3-caption:${fixture.name}:run`, epoch: env.epoch, pass: run.status === "done", decided_by: "code", ...(run.error ? { notes: [run.error] } : {}) }];
    for (const profile of CAPTION_PROFILES) {
      const row = mem.captions.find((c) => c.profile === profile.id);
      const text = row ? [row.title, row.text].filter(Boolean).join("\n") : "";
      env.log(`[${profile.id}] ${text}`);
      // The rules `cmo_save_caption` holds (`caption_check`): length, a title only on YouTube, no links, hashtags.
      const issues = !row
        ? ["no caption"]
        : [
            ...([...row.text].length > profile.limit ? ["too long"] : []),
            ...((row.title !== null) !== (profile.kind === "youtube") ? ["title on the wrong profile"] : []),
            ...(/https?:\/\/|www\./i.test(text) ? ["has a link"] : []),
            ...(countHashtags(text) > profile.hashtags ? ["too many hashtags"] : []),
          ];
      results.push(await cascade(`w3-caption:${fixture.name}:${profile.id}`, env.epoch, issues, env.judge, { job: `The ${profile.label} for a short video about: ${fixture.brief}`, docs: fixture.docs, output: text }));
      const patterns = row ? stockPatterns(row.text) : [];
      results.push({ id: `w3-caption:${fixture.name}:${profile.id}:style`, epoch: env.epoch, pass: Boolean(row) && patterns.length === 0, decided_by: "code", ...(patterns.length ? { notes: patterns } : row ? {} : { notes: ["no caption"] }) });
    }
    return results;
  },
};

registerCases([...platformPostCases, briefCase, captionCase]);
