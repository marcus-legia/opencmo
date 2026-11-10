/**
 * cmo-review-3 2.2, "Rate your first drafts": one round of ratings → rules (`distill_ratings`). Graded in code: two
 * drafts rated down as "Too salesy" teach a help-first rule, and a round of thumbs up only teaches nothing. Every rule
 * must fit 200 characters (the job's own check keeps only rules a rating supports).
 */

import type { CaseResult } from "@/lib/eval/compare";

import { memoryStore } from "../../memory-store";
import type { DraftRating } from "../../types";
import { registerCases, type EvalCase, type EvalEnv } from "../types";

const SALESY: DraftRating[] = [
  { id: "r1", item_id: "i1", version: 0, verdict: "down", reason_code: "TOO_SALESY", note: null, words: "Duely is the best invoicing tool ever made. Sign up today and never chase a client again!" },
  { id: "r2", item_id: "i1", version: 1, verdict: "up", reason_code: null, note: null, words: "Most late invoices are forgotten, not refused. A reminder on day 3 fixes most of them." },
  { id: "r3", item_id: "i2", version: 0, verdict: "down", reason_code: "TOO_SALESY", note: "Reads like an ad.", words: "Stop losing money! Duely gets you paid 3x faster. Try it free now." },
];
const LIKED: DraftRating[] = [
  { id: "r4", item_id: "i1", version: 0, verdict: "up", reason_code: null, note: null, words: "Most late invoices are forgotten, not refused." },
  { id: "r5", item_id: "i2", version: 0, verdict: "up", reason_code: null, note: null, words: "Send the same short reminder on day 3, 7 and 14." },
];

const HELP_FIRST = /help|pitch|sell|sales|hype|ad\b|advert|product/i;

async function round(env: EvalEnv, ratings: DraftRating[], name: string): Promise<{ ok: boolean; rules: string[]; error?: string }> {
  const mem = memoryStore({}, []);
  mem.ratings.set(name, ratings);
  const run = mem.enqueue("distill_ratings", { round: name });
  await env.drain(mem.store, { runId: run.id, budgetMs: 60_000 });
  const state = mem.runs.find((r) => r.id === run.id);
  if (state?.status !== "done") return { ok: false, rules: [], error: state?.error ?? "the run did not finish" };
  return { ok: true, rules: mem.ratingRules.get(name) ?? [] };
}

export const ratingsCase: EvalCase = {
  job: "r2",
  once: true,
  async run(_fixture, env) {
    const results: CaseResult[] = [];
    const salesy = await round(env, SALESY, "salesy");
    if (env.provider !== "fake") env.log(`r2 salesy: ${salesy.rules.join(" | ") || "(no rule)"}`);
    const notes = [
      ...(salesy.error ? [salesy.error] : []),
      ...(salesy.rules.some((r) => HELP_FIRST.test(r)) ? [] : ["no help-first rule from two salesy drafts"]),
      ...salesy.rules.filter((r) => r.length >= 200).map((r) => `rule too long: ${r.slice(0, 60)}…`),
      ...(salesy.rules.length > 5 ? ["more than five rules"] : []),
    ];
    results.push({ id: "r2:salesy", epoch: env.epoch, pass: salesy.ok && notes.length === 0, decided_by: "code", ...(notes.length ? { notes } : {}) });
    const liked = await round(env, LIKED, "liked");
    const likedNotes = [...(liked.error ? [liked.error] : []), ...(liked.rules.length ? [`${liked.rules.length} rules from thumbs up only`] : [])];
    results.push({ id: "r2:liked", epoch: env.epoch, pass: liked.ok && likedNotes.length === 0, decided_by: "code", ...(likedNotes.length ? { notes: likedNotes } : {}) });
    return results;
  },
};

registerCases([ratingsCase]);
