/**
 * Retakes: a sentence the speaker said again, so the earlier take can go.
 *
 * Pure (no workspace, no document) so the edge cases are tested on their own in `retakes.check.ts`.
 * The rules follow the MIT editing skills listed in THIRD_PARTY_NOTICES.md: compare sentences by word
 * 4-grams (> 0.7) inside a 60 s window, also catch a false start by its opening words, and keep the
 * LAST take, which is usually the one the speaker meant. It only suggests: the model reads the
 * transcript and decides, because a deliberate repetition looks the same as a retake to a counter.
 */

import type { Transcript, Word } from "@opencmo/editor-core";

/** Filler sounds: not content, so "So um the price" and "So the price" are the same sentence. */
export const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "hmm", "mm", "mhm"]);

/** Lower case without punctuation; letters of any script, so token matching works in any language. */
export const bare = (text: string): string => text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

export type Retake = {
  /** First and last word id of the take to keep (the last one said). */
  keep: [string, string];
  /** Earlier takes, oldest first, as [first word id, last word id] for remove_words. */
  drop: Array<[string, string]>;
  /** Every word id of the earlier takes, ready for one remove_words call. */
  drop_word_ids: string[];
  /** The kept take's text. */
  text: string;
  /** The weakest link in the group, 0–1, so the model can weigh a borderline match. */
  similarity: number;
};

export type RetakeOptions = {
  /** Two takes further apart than this (seconds, start to start) are a deliberate repetition. Default 60. */
  window?: number;
  /** Above this a pair is a retake. Default 0.7. */
  threshold?: number;
};

type Sentence = { words: Array<Word & { id: string }>; tokens: string[]; start: number };

const ENDS_SENTENCE = /[.?!…。？！]["')\]]*$/u;
const GRAM = 4;
const MIN_TOKENS = 3;
const OPENER = 3;
const ORDERED = 5;

/** Sentences from the transcript lines (a line end or . ? ! ends one), skipping cut words. */
function sentences(transcript: Transcript, removed: (word: Word) => boolean): Sentence[] {
  const out: Sentence[] = [];
  let current: Sentence["words"] = [];
  const close = () => {
    const tokens = current.map((word) => bare(word.text)).filter((token) => token && !FILLERS.has(token));
    if (tokens.length) out.push({ words: current, tokens, start: current[0]!.start });
    current = [];
  };
  for (const segment of transcript) {
    for (const word of segment.words) {
      if (!word.id || removed(word)) continue;
      current.push(word as Word & { id: string });
      if (ENDS_SENTENCE.test(word.text.trim())) close();
    }
    close();
  }
  return out;
}

/** Word n-grams; a sentence shorter than n is one gram, so short sentences still compare. */
function grams(tokens: string[], n: number): Set<string> {
  if (tokens.length <= n) return new Set([tokens.join(" ")]);
  const out = new Set<string>();
  for (let index = 0; index + n <= tokens.length; index++) out.add(tokens.slice(index, index + n).join(" "));
  return out;
}

const shared = (a: Set<string>, b: Set<string>): number => [...a].filter((gram) => b.has(gram)).length;

/** Longest common subsequence of words: the words both takes say, in the same order. */
function common(a: string[], b: string[]): number {
  let row = new Array<number>(b.length + 1).fill(0);
  for (const word of a) {
    const next = [0];
    for (let index = 0; index < b.length; index++) next.push(word === b[index] ? row[index]! + 1 : Math.max(row[index + 1]!, next[index]!));
    row = next;
  }
  return row[b.length]!;
}

/**
 * How much the earlier sentence `a` is a take of the later `b`, 0–1.
 * - Dice over word grams (4 words, fewer for short sentences): the same sentence said twice, maybe with a word changed.
 * - Words in order (sentences of 5+ words): a take with one word changed ("a day" → "every day")
 *   breaks every gram around that word but keeps nearly all its words in order.
 * - A false start ("The thing about pricing is" before the full sentence): same opening words and
 *   most of `a` is inside `b`. Only when `a` is the shorter one; a longer first take is a real
 *   sentence followed by a summary of it, not a retake.
 */
export function similarity(a: string[], b: string[]): number {
  if (a.length < MIN_TOKENS || b.length < MIN_TOKENS) return 0;
  // 4-grams on a short sentence break on one inserted word ("we doubled OUR revenue"), so short
  // sentences compare shorter grams: about a third of the shorter sentence, 2 to 4 words.
  const n = Math.min(GRAM, Math.max(2, Math.floor(Math.min(a.length, b.length) / 3)));
  const ga = grams(a, n);
  const gb = grams(b, n);
  const both = shared(ga, gb);
  const dice = (2 * both) / (ga.size + gb.size);
  const ordered = Math.min(a.length, b.length) >= ORDERED ? (2 * common(a, b)) / (a.length + b.length) : 0;
  const opens = a.length <= b.length && a.slice(0, OPENER).join(" ") === b.slice(0, OPENER).join(" ");
  const contained = opens ? both / ga.size : 0;
  return Math.round(Math.max(dice, ordered, contained) * 100) / 100;
}

/** Groups of takes of the same sentence, each keeping its last take. */
export function findRetakes(transcript: Transcript, removed: (word: Word) => boolean, options: RetakeOptions = {}): Retake[] {
  const window = options.window ?? 60;
  const threshold = options.threshold ?? 0.7;
  const list = sentences(transcript, removed);

  // Union-find over sentences: take 1 ~ take 2 ~ take 3 is one group even when 1 and 3 differ more.
  const parent = list.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)));
  const weakest = new Map<number, number>();
  for (let later = 1; later < list.length; later++) {
    for (let earlier = later - 1; earlier >= 0; earlier--) {
      if (list[later]!.start - list[earlier]!.start > window) break;
      const score = similarity(list[earlier]!.tokens, list[later]!.tokens);
      if (score <= threshold) continue;
      const a = root(earlier);
      const b = root(later);
      const low = Math.min(score, weakest.get(a) ?? 1, weakest.get(b) ?? 1);
      parent[a] = b;
      weakest.set(b, low);
    }
  }

  const groups = new Map<number, number[]>();
  list.forEach((_, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  const span = (sentence: Sentence): [string, string] => [sentence.words[0]!.id, sentence.words.at(-1)!.id];
  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .sort(([, a], [, b]) => a[0]! - b[0]!)
    .map(([key, members]) => {
      const last = list[members.at(-1)!]!;
      return {
        keep: span(last),
        drop: members.slice(0, -1).map((index) => span(list[index]!)),
        drop_word_ids: members.slice(0, -1).flatMap((index) => list[index]!.words.map((word) => word.id)),
        text: last.words.map((word) => word.text.trim()).join(" "),
        similarity: weakest.get(key) ?? 1,
      };
    });
}
