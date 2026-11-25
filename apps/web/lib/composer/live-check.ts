/**
 * The Composer's live checks (plan docs/superpowers/plans/2026-11-25-composer.md, Task C1): what code can tell the
 * founder about their own post on every change, for no credits. The AI check (`compose_check`, on a button) catches
 * what a pattern cannot ("generic business advice, no SaaS angle"); these catch links, the product's name, the words
 * the sub's guide says to avoid, the no-ai-slop patterns the writer is held to, and length.
 *
 * Pure, no network: the screen runs it on every keystroke, so it must stay well under 5 ms for a 3,000-character post
 * (`live-check.check.ts` measures it). Every issue quotes the exact sentence it is about, so the screen can underline
 * it; a whole-post issue (length) quotes "".
 */

import { profileOf, countHashtags } from "@/lib/cmo/platforms";
import { slopFix, slopPatterns, type SlopPattern } from "@/lib/cmo/slop";

import type { ComposeIssue, ComposePlatform, ComposerContext } from "./types";

export type LiveCheckInput = {
  platform: ComposePlatform;
  title: string;
  body: string;
  context: ComposerContext;
  /** The founder's product names (the Product document's `name`, and any the screen adds). */
  products: string[];
};

/** Reddit's own limits for a text post. */
export const REDDIT_TITLE_MAX = 300;
export const REDDIT_BODY_MAX = 40_000;

type Field = ComposeIssue["field"];
type Sentence = { text: string; field: Field };

const CLOSERS = new Set(['"', "'", "”", "’", ")", "]"]);

/**
 * A sentence ends at . ! ? followed by a space or the end (with any closing quote or bracket), or at a line break, so
 * "ferreto.io/app" and "3.5" stay inside their sentence. Each sentence is an exact substring of the text, trimmed.
 */
export function sentences(text: string, field: Field = "body"): Sentence[] {
  const out: Sentence[] = [];
  const push = (from: number, to: number) => {
    const s = text.slice(from, to).trim();
    if (/[\p{L}\p{N}]/u.test(s)) out.push({ text: s, field });
  };
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\n") {
      push(start, i);
      start = i + 1;
    } else if (c === "." || c === "!" || c === "?") {
      let end = i + 1;
      while (end < text.length && (text[end] === "." || text[end] === "!" || text[end] === "?")) end++;
      while (end < text.length && CLOSERS.has(text[end]!)) end++;
      if (end >= text.length || /\s/.test(text[end]!)) {
        push(start, end);
        start = end;
      }
      i = end - 1;
    }
  }
  push(start, text.length);
  return out;
}

// A URL with a scheme, a bare www. host, or a bare domain on the TLDs founders' products use ("ferreto.io/app").
const LINK = /\bhttps?:\/\/[^\s<>()]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>()]*|\b[a-z0-9][a-z0-9-]*\.(?:com|io|app|ai|co|dev|so|net|org|xyz|tech|tools|sh|me)\b(?:\/[^\s<>()]*)?/i;

// "I built", "I'm building", "my own", "(I made it)": the founder says the product is theirs.
// "disclosure:" sits outside the closing \b: after ":" comes a space, which is no word boundary (review 2026-11-25).
const DISCLOSURE = /\b(?:(?:i(?:'|’)?m (?:the )?(?:founder|maker|building)|i (?:built|made|make|run|am building|founded|created)|we (?:built|made|are building|run)|my (?:own )?(?:tool|product|app|startup|saas|company)|full disclosure|i work on)\b|disclosure:)/i;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-bounded, case-insensitive: "Ferreto" matches "ferreto's", not "Ferretoes". Unicode letters count as words. */
function phrase(p: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escape(p.trim())}(?![\\p{L}\\p{N}_])`, "iu");
}

/**
 * The phrases a guide line names to avoid: the quoted ones ('"my tool", links, "DM me"' gives "my tool" and "DM me"),
 * or the whole line when it is a short phrase itself. A prose line with no quotes ("generic business advice") is
 * advice for the AI check, not a pattern.
 */
export function avoidPhrases(lines: readonly string[]): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    // Double quotes only: an apostrophe ("Don't post 'buy now'") is not a quote mark here.
    const quoted = [...line.matchAll(/["“”]([^"“”]{2,60})["“”]/g)].map((m) => m[1]!.trim());
    if (quoted.length) for (const q of quoted) out.add(q);
    else if (/^[\p{L}\p{N}' -]{2,30}$/u.test(line.trim()) && line.trim().split(/\s+/).length <= 3 && !/\b(?:links?|advice|posts?)\b/i.test(line)) out.add(line.trim());
  }
  return [...out].filter((p) => p.length >= 2);
}

const MAX_ISSUES = 40;

export function liveCheck(input: LiveCheckInput): ComposeIssue[] {
  const { platform, context } = input;
  const reddit = platform === "reddit";
  const title = reddit ? input.title : "";
  const body = input.body;
  const sub = reddit ? context.subreddit : null;
  const subName = sub ? `r/${sub.name}` : "this sub";
  const all = [...sentences(title, "title"), ...sentences(body, "body")];
  const issues: ComposeIssue[] = [];
  const add = (i: Omit<ComposeIssue, "source">) => issues.push({ ...i, source: "code" });

  // Links. A sub that forbids promotion removes them; elsewhere they are the first thing Reddit's spam filter weighs
  // on a new account, and the platforms' feeds show a link post to fewer people (platforms.json: no links).
  const forbids = sub?.verdict === "no_product_mention" || sub?.verdict === "skip";
  for (const s of all) {
    if (!LINK.test(s.text)) continue;
    add({
      quote: s.text,
      field: s.field,
      rule: "Links",
      severity: forbids ? "block" : "warn",
      why: reddit
        ? forbids
          ? `${subName} does not allow promotion, and a link to your product reads as one.`
          : "A link in a post from a newer account is what Reddit's spam filter removes most often. Leave it out, or add it in a comment if someone asks."
        : "Posts with a link reach fewer people. Put the link in a reply instead.",
      suggestion: null,
    });
  }

  // The product's name. Reddit only: on the founder's own X, Threads or LinkedIn their product is expected.
  const names = [...new Set(input.products.map((p) => p.trim()).filter((p) => p.length >= 3))].map((n) => [n, phrase(n)] as const);
  if (reddit && names.length) {
    const disclosed = DISCLOSURE.test(`${title}\n${body}`);
    for (const s of all) {
      const name = names.find(([, re]) => re.test(s.text))?.[0];
      if (!name) continue;
      if (sub?.verdict === "no_product_mention" || sub?.verdict === "skip")
        add({ quote: s.text, field: s.field, rule: "Product mention", severity: "block", why: `${subName} does not allow mentioning your own product.`, suggestion: null });
      else if (!disclosed)
        add({
          quote: s.text,
          field: s.field,
          rule: "Product mention",
          severity: "warn",
          why: sub?.verdict === "requires_disclosure" ? `${subName} asks you to say ${name} is yours before you mention it.` : `Say ${name} is yours first ("I built ${name}"), or leave the name out.`,
          suggestion: null,
        });
    }
  }

  // The sub's own "avoid" list, as far as it names phrases.
  if (sub) {
    const avoid = avoidPhrases(sub.guide.avoid).map((p) => [p, phrase(p)] as const);
    for (const s of all)
      for (const [p, re] of avoid)
        if (re.test(s.text)) add({ quote: s.text, field: s.field, rule: `${subName} guide`, severity: "warn", why: `${subName}'s rules read as avoiding "${p}".`, suggestion: null });
  }

  // No AI slop: the patterns the writer's drafts are held to, per sentence. A question at the end is how a Reddit post
  // asks for answers, so it counts only on the feeds, where it reads as baiting replies.
  const ending = new Set<SlopPattern>(["closing_question", "recap_ending"]);
  // The writer's line for hype points at "the documents"; the founder writes from what they know.
  const fix = (p: SlopPattern) => (p === "hype" ? "It uses a hype word. Use a plain word, or a number you have." : slopFix(p));
  for (const s of all)
    for (const p of slopPatterns(s.text))
      if (!ending.has(p)) add({ quote: s.text, field: s.field, rule: "No AI slop", severity: "warn", why: fix(p), suggestion: null });
  const last = sentences(body).at(-1);
  if (last)
    for (const p of slopPatterns(body))
      if (ending.has(p) && !(reddit && p === "closing_question")) add({ quote: last.text, field: "body", rule: "No AI slop", severity: "warn", why: fix(p), suggestion: null });

  // Length and shape.
  if (reddit) {
    if (!title.trim() && body.trim()) add({ quote: "", field: "title", rule: "Title", severity: "block", why: "A Reddit post needs a title.", suggestion: null });
    if (title.length > REDDIT_TITLE_MAX) add({ quote: "", field: "title", rule: "Length", severity: "block", why: `Reddit titles stop at ${REDDIT_TITLE_MAX} characters; this one is ${title.length}.`, suggestion: null });
    const letters = title.replace(/[^\p{L}]/gu, "");
    if (letters.length >= 8 && letters === letters.toUpperCase() && letters !== letters.toLowerCase())
      add({ quote: title.trim(), field: "title", rule: "Title", severity: "warn", why: "An all-caps title reads as shouting and trips automod in many subs.", suggestion: null });
    if (body.length > REDDIT_BODY_MAX) add({ quote: "", field: "body", rule: "Length", severity: "block", why: `Reddit text posts stop at ${REDDIT_BODY_MAX.toLocaleString("en-US")} characters.`, suggestion: null });
  } else {
    const profile = profileOf(platform);
    if (profile) {
      if (body.length > profile.limit)
        add({ quote: "", field: "body", rule: "Length", severity: "block", why: `${profile.label} takes ${profile.limit.toLocaleString("en-US")} characters; this is ${body.length.toLocaleString("en-US")}.`, suggestion: null });
      if (countHashtags(body) > profile.hashtags)
        add({ quote: "", field: "body", rule: "Hashtags", severity: "warn", why: `Posts on ${profile.label} read better without hashtags.`, suggestion: null });
      const first = body.split("\n")[0] ?? "";
      if (profile.visibleBeforeMore && first.length > profile.visibleBeforeMore)
        add({ quote: first.trim(), field: "body", rule: "First line", severity: "warn", why: `About ${profile.visibleBeforeMore} characters show before "see more". Put the point in the first line.`, suggestion: null });
    }
  }

  // One issue per sentence and rule, blocks first, capped so a pasted wall of text does not bury the screen.
  const seen = new Set<string>();
  return issues
    .filter((i) => {
      const key = `${i.field}\u0000${i.rule}\u0000${i.quote}\u0000${i.why}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "block" ? -1 : 1))
    .slice(0, MAX_ISSUES);
}
