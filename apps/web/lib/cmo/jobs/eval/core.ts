/**
 * W1 plan_week, W2 post_draft and W5 video_pack as registry cases. What they check is unchanged
 * from the table-only `eval.ts`; W2's drafts now also go through the judge once they pass the code.
 *
 * Every case returns `${job}:${fixture}:run` first (the run finished and has the right shape), then
 * one result per output. The runner's table reads that layout.
 *
 *   W1 — finished, 5–10 items, at most one Reddit item a day, video only when the strategy mentions
 *        it, every item has a reason, no avoid words or invented numbers (code only)
 *   W2 — finished; each of the three versions passes `checkPost`, then the judge
 *   W5 — finished; each clip got real captions (not the hook-only fallback) that pass `checkCaptions`
 */

import type { CaseResult } from "@/lib/eval/compare";

import { checkPost } from "../check-post";
import { avoidList, knownNumbers, normalizeNumber } from "../context";
import { cascade } from "../judge";
import { memoryStore } from "../memory-store";
import type { Documents, PlatformCaptions } from "../types";
import { checkCaptions } from "../video-pack";
import { registerCases, type EvalCase } from "./types";

const BUDGET_MS = 240_000;

/**
 * Avoid words and numbers the documents do not contain, in a plan item's idea (it becomes the
 * post's brief). The reason is not checked for numbers: it may quote the playbook's mix ("about
 * 30% of the week"). Lengths such as "a 30-second clip" are formats, not claims.
 */
export function ideaIssues(idea: string, reason: string, docs: Documents): string[] {
  const issues: string[] = [];
  const lower = `${idea} ${reason}`.toLowerCase();
  for (const word of avoidList(docs)) if (word.length >= 3 && lower.includes(word.toLowerCase())) issues.push(`uses "${word}"`);
  const known = knownNumbers(docs);
  const text = idea.replace(/\d+[- ]?(seconds?|secs?|minutes?|mins?)\b/gi, "");
  for (const raw of text.match(/\d[\d,.]*%?/g) ?? []) {
    const n = normalizeNumber(raw.replace(/%$/, ""));
    if (!raw.endsWith("%") && Number(n) < 10) continue;
    if (/^(19|20)\d\d$/.test(n)) continue;
    if (!known.has(n)) issues.push(`says ${raw}`);
  }
  return issues;
}

const mentionsVideo = (docs: Documents) => /video|clip|record|reel|short|tiktok/i.test(JSON.stringify(docs.content_strategy ?? {}));

const runResult = (id: string, epoch: number, ok: boolean, notes: string[]): CaseResult => ({ id, epoch, pass: ok, decided_by: "code", ...(notes.length ? { notes } : {}) });

const w1: EvalCase = {
  job: "w1",
  async run(fixture, env) {
    const mem = memoryStore(fixture.docs, []);
    const run = mem.enqueue("plan_week", {});
    await env.drain(mem.store, { runId: run.id, budgetMs: BUDGET_MS });
    const plan = mem.items.filter((i) => i.run_id === run.id);
    const salesPerDay = new Map<string, number>();
    for (const item of plan) if (item.department === "sales") salesPerDay.set(item.day, (salesPerDay.get(item.day) ?? 0) + 1);
    const shapeOk =
      plan.length >= 5 && plan.length <= 10 &&
      [...salesPerDay.values()].every((n) => n <= 1) &&
      (mentionsVideo(fixture.docs) || plan.every((i) => i.department !== "video"));
    const notes = [...(run.error ? [run.error] : []), ...(shapeOk ? [] : [`plan shape is off: ${plan.length} items, Reddit per day ${JSON.stringify(Object.fromEntries(salesPerDay))}`])];
    const results: CaseResult[] = [runResult(`w1:${fixture.name}:run`, env.epoch, run.status === "done" && shapeOk, notes)];
    plan.forEach((item, index) => {
      const issues = [...(item.reason.trim() ? [] : ["no reason"]), ...ideaIssues(item.idea, item.reason, fixture.docs)];
      env.log(`${item.day} ${item.department.padEnd(5)} ${item.idea} — ${item.reason}${issues.length ? `  ✗ ${issues.join("; ")}` : ""}`);
      results.push({ id: `w1:${fixture.name}:item-${index}`, epoch: env.epoch, pass: issues.length === 0, decided_by: "code", ...(issues.length ? { notes: issues } : {}) });
    });
    return results;
  },
};

const w2: EvalCase = {
  job: "w2",
  async run(fixture, env) {
    const mem = memoryStore(fixture.docs, []);
    const run = mem.enqueue("post_draft", { idea: fixture.brief });
    await env.drain(mem.store, { runId: run.id, budgetMs: BUDGET_MS });
    const item = mem.items.find((i) => i.run_id === run.id);
    if (item?.body.gen) env.recordGen("w2", item.body.gen);
    const texts = item ? [String(item.body.text ?? ""), ...((item.body.alternates as string[] | undefined) ?? [])] : [];
    const rules = { avoid: avoidList(fixture.docs), known: knownNumbers(fixture.docs) };
    const results: CaseResult[] = [runResult(`w2:${fixture.name}:run`, env.epoch, run.status === "done", run.error ? [run.error] : [])];
    // Always three outputs, so a run that drafted fewer pairs as fails, not as missing cases.
    for (let index = 0; index < 3; index++) {
      const text = texts[index] ?? "";
      env.log(`[${index + 1}] ${text}`);
      const issues = text ? checkPost(text, rules) : ["no draft"];
      results.push(await cascade(`w2:${fixture.name}:${index}`, env.epoch, issues, env.judge, { job: `An X post for the founder on: ${fixture.brief}`, docs: fixture.docs, output: text }));
    }
    return results;
  },
};

const w5: EvalCase = {
  job: "w5",
  async run(fixture, env) {
    const mem = memoryStore(fixture.docs, []);
    mem.jobs.set("job-1", { status: "done", error: null, createdAt: new Date().toISOString(), title: "Founder talk", clips: fixture.clips });
    const run = mem.enqueue("video_pack", { job_id: "job-1" });
    await env.drain(mem.store, { runId: run.id, budgetMs: BUDGET_MS });
    const pack = mem.packs.find((p) => p.runId === run.id);
    const rules = { avoid: avoidList(fixture.docs), known: knownNumbers(fixture.docs) };
    const results: CaseResult[] = [runResult(`w5:${fixture.name}:run`, env.epoch, run.status === "done", run.error ? [run.error] : [])];
    for (const c of fixture.clips) {
      const captions: PlatformCaptions | undefined = pack?.captions[c.id];
      const id = `w5:${fixture.name}:clip-${c.idx}`;
      if (!captions) {
        results.push({ id, epoch: env.epoch, pass: false, decided_by: "code", notes: ["no captions"] });
        continue;
      }
      // The hook-only fallback means the model's captions failed the checks twice.
      const fellBack = captions.tiktok.trim() === c.hook.trim() && captions.threads.trim() === c.hook.trim();
      const issues = [...(fellBack ? ["fell back to the hook"] : []), ...checkCaptions(captions, { ...rules, spoken: normalizeNumber(c.text) })];
      env.log(`clip ${c.idx}${fellBack ? " (fell back to the hook)" : ""}`);
      for (const [platform, text] of Object.entries(captions)) env.log(`  ${platform}: ${text.replace(/\n/g, " ⏎ ")}`);
      results.push({ id, epoch: env.epoch, pass: issues.length === 0, decided_by: "code", ...(issues.length ? { notes: issues } : {}) });
    }
    return results;
  },
};

registerCases([w1, w2, w5]);
