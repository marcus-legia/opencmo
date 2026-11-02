/**
 * Stock patterns from the No AI Slop guidance (`lib/cmo/skills/no-ai-slop.md`), found by code in eval
 * outputs so a prompt change can be measured before and after (`writer.md` §5, §9).
 *
 * Eval only. Production never runs this: there the guidance is advice the writer and the checker read,
 * and a pattern never drops a draft. Each check is narrow on purpose; a miss costs a less precise number,
 * a false hit would blame a good draft.
 */

export const STOCK_PATTERNS = {
  binary_contrast: [/\b(?:is|was|are)\s+not\s+[^.?!\n]{1,60}[.;,]\s*(?:it'?s|it is|this is|that'?s)\b/i, /\bisn['’]t\s+[^.?!\n]{1,60}[.;,]\s*(?:it['’]s|it is)\b/i, /\bnot just\b[^.?!\n]{1,60}\bbut\b/i],
  faux_insight: [
    /\bmost (?:people|founders|teams|developers|devs)(?:\s+\w+){0,2}\s+(?:skip|miss|ignore|get (?:this|it) wrong|overlook)\b/i,
    /\bwhat (?:most people|nobody|no one) (?:gets? wrong|tells you|talks about)\b/i,
    /\bthe part (?:everyone|most people|nobody) (?:misses|skips|gets wrong)\b/i,
  ],
  throat_clearing: [/(?:^|\n)\s*(?:here['’]s the thing|here['’]s what i mean|let me be clear|i['’]ll be honest|the (?:uncomfortable|hard) truth is)\b/i],
  /** A short label, a colon, then a lowercase reveal on the same line ("The best part: it learns"). */
  colon_reveal: [/(?:^|\n|[.!?]\s)[A-Z][^:\n.!?]{2,60}:[ \t]+[a-z]/],
  rhetorical_setup: [/\b(?:what if i told you|think about it:|plot twist:)/i],
  /** The last sentence opens with a recap word as a transition ("Ultimately, …"), not "Overall revenue grew". */
  recap_ending: [/(?:^|[.!?]\s+|\n)(?:(?:in conclusion|ultimately|overall|in short|to sum up)\s*[,:]|the bottom line is\b)[^\n]*$/i],
  /** Short copy (a post, a caption, a reply) uses none. */
  em_dash: [/—/],
} as const satisfies Record<string, readonly RegExp[]>;

export type StockPattern = keyof typeof STOCK_PATTERNS;

/** The stock patterns a text shows, by name; empty when none. */
export function stockPatterns(text: string): StockPattern[] {
  return (Object.keys(STOCK_PATTERNS) as StockPattern[]).filter((name) => STOCK_PATTERNS[name].some((re) => re.test(text)));
}
