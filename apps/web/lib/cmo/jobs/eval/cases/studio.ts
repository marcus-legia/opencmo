/**
 * S4 Studio squad evals (P6, `studio.md` §10). One case per squad that raises a video-like card, on fixed
 * inputs; each squad's own reviewer is the code tier, the judge's questions are the model tier.
 *
 *   s4-shorts    — the Clip editor (`pickShorts`) on a fixed 90 s founder talk: `reviewShorts` (15–60 s,
 *                  whole sentences, the hook in the first 3 s, the right count), then the judge per short
 *
 * Judge questions are constants below; they go into the report word for word.
 */

import type { CaseResult } from "@/lib/eval/compare";
import { pickShorts, reviewShorts, shortCount, candidates, type Word } from "@/lib/departments/studio/shorts/squad";

import { checkRules } from "../../context";
import { cascade } from "../../judge";
import { memoryStore } from "../../memory-store";
import { FIXTURES } from "../fixtures";
import type { EvalSquad } from "../studio-types";
import { registerCases, type EvalCase, type EvalEnv } from "../types";

const BUDGET_MS = 240_000;

export const SHORT_QUESTIONS = [
  "The short makes sense on its own: someone who never saw the full video understands it.",
  "Its first sentence is a hook that makes a founder want to keep watching.",
] as const;

/** A fixed 90 s founder talk (Paylane, the first fixture): sentences timed at about 2.5 words a second. */
export const TALK = [
  "Most freelancers lose money on invoices they already earned.",
  "Not because clients refuse to pay, but because nobody reminds them.",
  "I learned this the hard way in my first year of freelancing.",
  "Half my invoices went quiet, and I felt rude chasing them.",
  "So I wrote one polite reminder and sent it on day three, day seven and day fourteen.",
  "The tone matters more than the timing.",
  "Say the amount, say the due date, and make paying one click away.",
  "Never apologise for asking to be paid for work you finished.",
  "After a few months I stopped dreading the end of the month.",
  "That reminder flow is what Paylane does for you now.",
  "You write the invoice, and it sends the reminders on your schedule.",
  "Clients get a friendly note with a pay button, nothing more.",
  "If they pay, the reminders stop on their own.",
  "If they do not, you see who is late before it becomes a problem.",
  "It costs twelve dollars a month, which is less than one late invoice.",
  "Try it on the next invoice you send this week.",
];

export function timedWords(sentences: readonly string[], wordsPerSecond = 2.5, pause = 0.4): Word[] {
  const words: Word[] = [];
  let at = 0;
  for (const sentence of sentences) {
    for (const text of sentence.split(/\s+/)) {
      const end = at + 1 / wordsPerSecond;
      words.push({ text, start: Math.round(at * 100) / 100, end: Math.round((end - 0.05) * 100) / 100 });
      at = end;
    }
    at += pause;
  }
  return words;
}

const fail = (id: string, epoch: number, note: string): CaseResult => ({ id, epoch, pass: false, decided_by: "error", notes: [note] });
const caseId = (squad: EvalSquad, fixture: string, output: string) => `s4-${squad.replace("_", "-")}:${fixture}:${output}`;

const shortsCase: EvalCase = {
  job: "s4-shorts",
  once: true,
  async run(_fixture, env) {
    const fixture = FIXTURES[0]!;
    const words = timedWords(TALK);
    const id = (output: string) => caseId("shorts", fixture.name, output);
    const picked = await pickShorts({ words, about: String(fixture.docs.product?.one_liner ?? "") });
    if (typeof picked === "string") return [fail(id("run"), env.epoch, picked)];
    const count = shortCount(candidates(words));
    const results: CaseResult[] = [{ id: id("run"), epoch: env.epoch, pass: true, decided_by: "code" }];
    const reviewer = reviewShorts(picked, words, count);
    results.push({ id: id("review"), epoch: env.epoch, pass: reviewer.length === 0, decided_by: "code", ...(reviewer.length ? { notes: reviewer } : {}) });
    for (const [index, short] of picked.entries()) {
      const text = words.filter((w) => w.start >= short.start && w.end <= short.end).map((w) => w.text).join(" ");
      env.log(`[short ${index + 1}] ${short.start}–${short.end} s · ${short.hook}: ${text}`);
      results.push(await cascade(id(`short-${index}`), env.epoch, [], env.judge, { job: "A stand-alone short cut from the founder's own video", docs: fixture.docs, output: text, criteria: [...SHORT_QUESTIONS] }));
    }
    return results;
  },
};

/** Shared for a check: the fake env runs the three cases end to end without a network. */
export const STUDIO_CASES: readonly EvalCase[] = [shortsCase];
export type { EvalEnv };

registerCases([...STUDIO_CASES]);
