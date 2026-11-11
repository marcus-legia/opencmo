/**
 * The no-ai-slop gate (owner, 2026-11-12): the stock patterns that make a post read as AI are refused in code, not only
 * advised in the prompt. A draft that shows one goes back to the writer with the fix; a version that still shows one
 * is dropped. The prompt-level guidance (`skills/no-ai-slop.md`) stays for everything a pattern list cannot catch.
 *
 * The founder's own writing wins: a pattern found in their rules or in a draft they edited is their voice, not slop,
 * and is let through for them (`founderPatterns`). Drafts approved as written are not their writing and do not count.
 */

import { STOCK_PATTERNS } from "./jobs/eval/style";

/** Pattern → what to do instead, as the fix round reads it. */
const GATE = {
  ...STOCK_PATTERNS,
  /** A spaced en dash or a double hyphen used as an em dash. */
  dash: [/\s[–]\s|\s--\s/],
  /** Headline formulas: the post states the thing instead of teasing it. */
  headline: [
    /\bthe (?:secret|key) to\b/i,
    /\bthe hidden\b[^.?!\n]{0,40}\b(?:cost|truth|reason|danger|price|problem)s?\b/i,
    /\bthe (?:danger|dangers|problem|truth) (?:of|with|about)\b[^.?!\n]{0,80}\b(?:and|–|-|—|:)\s*why\b/i,
    /\b(?:here['’]s|this is) (?:why|how|what)\b/i,
    /\bwhy [^.?!\n]{2,60}\b(?:beats|wins over|trumps)\b/i,
  ],
  /** Hype words the guidance always cuts. */
  hype: [
    /\b(?:game[- ]?changer|game[- ]?changing|this changes everything|revolutioni[sz]e|supercharge|unlock(?:s|ing)? (?:the|your)|next[- ]level|level up|delve|leverage|seamless(?:ly)?|cutting[- ]edge|paradigm shift|skyrocket|10x your)\b/i,
  ],
  /** A post that ends by asking the reader something to bait replies ("Which would you open first?"). */
  closing_question: [/[.!]\s+[^.!?\n]{3,140}\?\s*$/],
} as const satisfies Record<string, readonly RegExp[]>;

export type SlopPattern = keyof typeof GATE;

const FIX: Record<SlopPattern, string> = {
  binary_contrast: 'It uses a "not X, it\'s Y" contrast. Say Y directly.',
  faux_insight: 'It flatters itself as the lone expert ("what most people miss"). Cut the setup and state the claim.',
  throat_clearing: 'It opens with throat-clearing ("Here\'s the thing"). Start with the point.',
  colon_reveal: "It uses a colon reveal (a label, a colon, then a dramatic reveal). Write it as one plain sentence.",
  rhetorical_setup: 'It uses a rhetorical setup ("What if I told you"). Make the point.',
  recap_ending: 'It ends on a recap ("Ultimately, …"). End on the last concrete point.',
  em_dash: "It uses an em dash. Short copy uses none: use a period or a comma.",
  dash: "It uses a dash between clauses. Use a period or a comma.",
  headline: 'It reads like a headline formula ("the secret to", "the hidden cost", "here\'s why", "X beats Y"). Say the thing plainly.',
  hype: "It uses a hype word. Use a plain word, or a fact from the documents.",
  closing_question: "It ends with a question to bait replies. End on the point itself.",
};

const NAMES = Object.keys(GATE) as SlopPattern[];

/** The gate's patterns a text shows. */
export function slopPatterns(text: string): SlopPattern[] {
  return NAMES.filter((name) => GATE[name].some((re) => re.test(text)));
}

/** The patterns the founder's own writing uses: those are their voice and pass the gate for them. */
export function founderPatterns(texts: readonly string[]): Set<SlopPattern> {
  const found = new Set<SlopPattern>();
  for (const text of texts) for (const name of slopPatterns(text)) found.add(name);
  return found;
}

/** One line per pattern found and not allowed, each with its fix; empty when the text passes. */
export function slopIssues(text: string, allow: ReadonlySet<string> = new Set()): string[] {
  return slopPatterns(text)
    .filter((name) => !allow.has(name))
    .map((name) => FIX[name]);
}
