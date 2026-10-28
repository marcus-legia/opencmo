/**
 * The Shorts squad's thinking (P2 B4, `studio.md` §6): Segmenter (code) → Clip editor (one cheap LLM
 * call, agent `shorts`) → Clip reviewer (code, sends back once). The Builder (`make_short`) and the
 * Renderer (`renderShort`) run after it on the ranges this returns.
 *
 * Every range comes from the Segmenter, never from the model: the Clip editor only picks candidates
 * by id and writes the hook, title and reason, so a short always starts and ends on a whole sentence.
 * Times are the parent edit's timeline seconds.
 */

import { z } from "zod";

import { fakeAllowed, llmReady, LlmError, structured, type LlmUsage } from "@/lib/cmo/jobs/llm";

import type { ShortRange } from "../types";

export type Word = { text: string; start: number; end: number };
/** An AI long video's beats (the Director's shots), in timeline seconds. */
export type Beat = { start: number; end: number };

export const SHORTS_PER_VIDEO = 3;
export const SHORT_SECONDS = { min: 15, max: 60 } as const;
export const HOOK_SECONDS = 3;
/** The Clip editor ranks at most this many candidates: one cheap call. */
export const MAX_CANDIDATES = 8;
/** A beat edge this close to a sentence edge counts as the same cut. */
const BEAT_SNAP = 0.35;

export type Sentence = { start: number; end: number; text: string };
export type Candidate = Sentence & { id: number };

const ENDS_SENTENCE = /[.!?…]["')\]]*$/;

/** Words grouped into sentences by their closing punctuation; the last group ends the speech. */
export function sentences(words: readonly Word[]): Sentence[] {
  const out: Sentence[] = [];
  let open: Word[] = [];
  for (const word of words) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end < word.start || !word.text.trim()) continue;
    open.push(word);
    if (ENDS_SENTENCE.test(word.text.trim())) {
      out.push({ start: open[0]!.start, end: word.end, text: open.map((item) => item.text.trim()).join(" ") });
      open = [];
    }
  }
  if (open.length) out.push({ start: open[0]!.start, end: open.at(-1)!.end, text: open.map((item) => item.text.trim()).join(" ") });
  return out;
}

const onBeatEdge = (time: number, beats: readonly Beat[], edge: "start" | "end") => beats.some((beat) => Math.abs(beat[edge] - time) <= BEAT_SNAP);

/**
 * Runs of whole sentences that last 15–60 s. With beats (an AI long video), runs that start and end
 * on a beat edge come first, so a short never cuts a shot in half. At most `MAX_CANDIDATES`, spread
 * over the video and nearest 30 s first.
 */
export function candidates(words: readonly Word[], beats: readonly Beat[] = []): Candidate[] {
  const list = sentences(words);
  const runs: Sentence[] = [];
  for (let first = 0; first < list.length; first++) {
    for (let last = first; last < list.length; last++) {
      const start = list[first]!.start;
      const end = list[last]!.end;
      if (end - start > SHORT_SECONDS.max) break;
      if (end - start >= SHORT_SECONDS.min) runs.push({ start, end, text: list.slice(first, last + 1).map((item) => item.text).join(" ") });
    }
  }
  const onBeats = beats.length ? runs.filter((run) => onBeatEdge(run.start, beats, "start") && onBeatEdge(run.end, beats, "end")) : [];
  const pool = onBeats.length >= SHORTS_PER_VIDEO ? onBeats : runs;
  // One candidate per opening sentence (the one nearest 30 s), then the nearest 30 s across openings.
  const byStart = new Map<number, Sentence>();
  for (const run of pool) {
    const best = byStart.get(run.start);
    if (!best || Math.abs(run.end - run.start - 30) < Math.abs(best.end - best.start - 30)) byStart.set(run.start, run);
  }
  const spread = [...byStart.values()].sort((a, b) => a.start - b.start);
  const step = Math.max(1, spread.length / MAX_CANDIDATES);
  const picked: Sentence[] = [];
  for (let index = 0; index < spread.length && picked.length < MAX_CANDIDATES; index += step) picked.push(spread[Math.floor(index)]!);
  return picked.map((run, id) => ({ ...run, id }));
}

const overlaps = (a: Beat, b: Beat) => a.start < b.end && b.start < a.end;

/** The most shorts that fit without overlap (greedy by end, which is optimal), at most three. */
export function shortCount(list: readonly Candidate[]): number {
  let count = 0;
  let free = -Infinity;
  for (const item of [...list].sort((a, b) => a.end - b.end)) {
    if (item.start >= free) {
      count++;
      free = item.end;
    }
  }
  return Math.min(SHORTS_PER_VIDEO, count);
}

const normal = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * The Clip reviewer. Each short starts on a sentence start and ends on a sentence end (so no name or
 * number is split), lasts 15–60 s, opens with its hook inside the first 3 s, and overlaps no other.
 */
export function reviewShorts(shorts: readonly ShortRange[], words: readonly Word[], count: number): string[] {
  const issues: string[] = [];
  const list = sentences(words);
  if (shorts.length !== count) issues.push(`Pick exactly ${count} shorts; there are ${shorts.length}.`);
  shorts.forEach((short, index) => {
    const name = `Short ${index + 1}`;
    const length = short.end - short.start;
    if (!(length >= SHORT_SECONDS.min - 1e-6 && length <= SHORT_SECONDS.max + 1e-6)) issues.push(`${name} is ${length.toFixed(1)}s; a short lasts ${SHORT_SECONDS.min}–${SHORT_SECONDS.max}s.`);
    if (!list.some((sentence) => Math.abs(sentence.start - short.start) < 1e-3)) issues.push(`${name} does not start at the start of a sentence.`);
    if (!list.some((sentence) => Math.abs(sentence.end - short.end) < 1e-3)) issues.push(`${name} does not end at the end of a sentence.`);
    const opening = normal(
      words
        .filter((word) => word.start >= short.start - 1e-3 && word.start < short.start + HOOK_SECONDS)
        .map((word) => word.text)
        .join(" "),
    );
    const hook = normal(short.hook);
    const head = hook.slice(0, Math.min(3, hook.length, opening.length));
    if (!hook.length || !head.length || head.some((word, at) => word !== opening[at])) issues.push(`${name}'s hook is not what is said in its first ${HOOK_SECONDS} seconds.`);
    shorts.slice(index + 1).forEach((other, offset) => {
      if (overlaps(short, other)) issues.push(`${name} overlaps short ${index + offset + 2}.`);
    });
  });
  return issues;
}

const picksSchema = z.object({
  picks: z
    .array(
      z.object({
        candidate: z.number().int().min(0),
        hook: z.string().min(1).max(120),
        title: z.string().min(1).max(60),
        reason: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(SHORTS_PER_VIDEO),
});

export const CLIP_EDITOR = `You are the clip editor of a short-video team. From a finished marketing video, pick the candidates that make the best stand-alone shorts (15 to 60 seconds, vertical).
- Pick exactly the number asked for, by candidate id. Never pick two candidates that overlap in time.
- A good short: a hook that grabs in the first seconds and fits the topic, a logical flow with a satisfying end, one idea of value. It must make sense without the rest of the video.
- hook: the opening line exactly as it is said at the start of the candidate (its first words), at most 120 characters.
- title: a plain title for the short, at most 60 characters, no hashtags, no emoji.
- reason: one sentence on why it works (hook, flow, value). Never promise views or virality.`;

const FAILED = "The clip editor could not pick shorts right now. Try again in a minute.";

function fakePicks(list: readonly Candidate[], count: number) {
  const picks: { candidate: number; hook: string; title: string; reason: string }[] = [];
  for (const item of [...list].sort((a, b) => Math.abs(a.end - a.start - 30) - Math.abs(b.end - b.start - 30))) {
    if (picks.length === count) break;
    if (picks.some((pick) => overlaps(list[pick.candidate]!, item))) continue;
    const opening = sentences([{ text: item.text, start: item.start, end: item.end }])[0]!.text;
    picks.push({ candidate: item.id, hook: opening.slice(0, 120), title: item.text.split(/\s+/).slice(0, 6).join(" ").slice(0, 60), reason: "Opens on a whole sentence and ends on one." });
  }
  return { picks };
}

const toRanges = (list: readonly Candidate[], picks: z.infer<typeof picksSchema>["picks"]): ShortRange[] =>
  picks.flatMap((pick) => {
    const item = list[pick.candidate];
    return item ? [{ start: item.start, end: item.end, hook: pick.hook, title: pick.title, reason: pick.reason }] : [];
  });

/** Picks the shorts of a finished edit, or says why there are none. Sorted by start. */
export async function pickShorts(input: { words: readonly Word[]; beats?: readonly Beat[]; about?: string }, onUsage?: (usage: LlmUsage) => Promise<void>): Promise<ShortRange[] | string> {
  const list = candidates(input.words, input.beats);
  const count = shortCount(list);
  if (!count) return `This video has no stretch of ${SHORT_SECONDS.min}–${SHORT_SECONDS.max} seconds of whole sentences to cut a short from.`;
  const sorted = (ranges: ShortRange[]) => [...ranges].sort((a, b) => a.start - b.start);
  if (fakeAllowed()) return sorted(toRanges(list, fakePicks(list, count).picks));
  if (!llmReady("shorts")) return "The clip editor is not set up on this server yet.";
  const facts = `${input.about ? `<video>${input.about}</video>\n` : ""}<count>${count}</count>\n<candidates>${JSON.stringify(list.map((item) => ({ id: item.id, start: item.start, end: item.end, seconds: Math.round((item.end - item.start) * 10) / 10, text: item.text })))}</candidates>`;
  let ranges: ShortRange[] = [];
  let issues: string[] = [];
  try {
    for (let round = 0; round < 2; round++) {
      const draft = await structured({
        agent: "shorts",
        label: "studio.shorts",
        failure: FAILED,
        maxTokens: 1500,
        ...(onUsage ? { onUsage } : {}),
        system: CLIP_EDITOR,
        prompt: issues.length ? `${facts}\n<previous>${JSON.stringify(ranges)}</previous>\n<reviewer>${issues.join("\n")}</reviewer>\nFix every reviewer note.` : facts,
        schema: picksSchema,
      });
      ranges = sorted(toRanges(list, draft.picks));
      issues = reviewShorts(ranges, input.words, count);
      if (!issues.length) return ranges;
    }
  } catch (error) {
    return error instanceof LlmError ? error.message : FAILED;
  }
  return `The shorts still had problems after one revision: ${issues.slice(0, 3).join(" ")}`;
}
