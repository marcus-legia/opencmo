/**
 * Code checks on a post BEFORE a model check costs money: length, words to avoid, made-up numbers, and
 * the product rules for posts (owner, 2026-10-26, `writer.md` §7): no links and no hashtags in a post;
 * hashtags belong only on video captions. A number of 10 or more, or a percentage, must appear in the
 * founder's documents (no invented numbers).
 *
 * Only facts and product rules live here. Writing style (No AI Slop) is advice the writer and the checker
 * read in a skill, never a check that drops a draft.
 */

import { countHashtags } from "../platforms";
import { slopIssues } from "../slop";
import { xLength } from "@/lib/departments/publish/split";

import { normalizeNumber, numberTokens } from "./context";

export const X_LIMIT = 280;

/** `names`: the founder's own product name(s), which may look like a domain ("Cal.com") and are not links. */
/**
 * `allowSlop`: the no-ai-slop patterns the founder's own writing uses, which pass the gate for them (`lib/cmo/slop.ts`).
 * `noProduct`: the brief says not to pitch the product, so a version that names it (`names`) is refused.
 */
export type CheckRules = { avoid: string[]; known: Set<string>; names?: string[]; allowSlop?: ReadonlySet<string>; noProduct?: boolean };

/** A brief that asks for no product pitch ("No product pitch", "don't mention OpenCMO", "no promo"). */
const NO_PITCH = /\bno (?:product )?(?:pitch|plug|promo(?:tion)?|product mention)s?\b|\b(?:don['’]t|do not|never) (?:pitch|plug|promote|mention|name)\b/i;

export function asksNoPitch(brief: string): boolean {
  return NO_PITCH.test(brief);
}

/**
 * The rules for one brief. The founder's own brief (CMO chat, Write it) carries facts they gave: its numbers count as
 * known, as the documents' do. A brief the planner wrote does not: its numbers must still be in the documents. Either
 * kind can ask for no product pitch.
 */
export function briefRules(rules: CheckRules, brief: string, fromFounder: boolean): CheckRules {
  const known = new Set(rules.known);
  if (fromFounder) {
    for (const raw of brief.match(/\d[\d,.]*/g) ?? []) known.add(normalizeNumber(raw));
    for (const token of numberTokens(brief)) known.add(token.n);
  }
  return { ...rules, known, ...(asksNoPitch(brief) ? { noProduct: true } : {}) };
}

/**
 * Always a link: a URL, a `www.` address, or a domain with a path ("opencmo.io/pricing"), but not a code file name
 * with a slash after it ("Next.js/React"). SQL's `caption_check` holds the same; the cases are
 * `packages/contracts/link-cases.json`.
 */
const URL_LIKE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+|\b[a-z0-9][a-z0-9-]*\.(?!(?:jsx?|tsx?|mjs|py|rb|css|html?|md|json|ya?ml|txt|sql|vue|svelte)\/)[a-z]{2,}\/\S/i;
/** A bare domain on a TLD people link to ("acme.io"); not "Next.js". */
const BARE_DOMAIN = /\b[a-z0-9][a-z0-9-]*\.(?:com|io|ai|co|app|dev|net|org|so|xyz|me|ly|gg|sh|to|tv|link|site|online|store|tech|page|info|biz|us|uk)\b(?!\.\w)/gi;

/** A link, except a bare domain that is the founder's own product name (`names`, from the product document). */
export function hasLink(text: string, names: readonly string[] = []): boolean {
  if (URL_LIKE.test(text)) return true;
  const own = new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean));
  return [...text.matchAll(BARE_DOMAIN)].some((m) => !own.has(m[0].toLowerCase()));
}
/** Hashtags the way the platforms count them ("#buildinpublic", not "#1" or "C#"), the same count the cards show. */
export const hashtagCount = countHashtags;

/** Words the strategy says to avoid, and numbers the documents do not hold: the fact checks every kind shares. */
export function factIssues(text: string, rules: CheckRules): string[] {
  const issues: string[] = [];
  const lower = text.toLowerCase();
  for (const word of rules.avoid) {
    const w = word.toLowerCase();
    if (w.length >= 3 && lower.includes(w)) issues.push(`It uses "${word}", which your strategy says to avoid.`);
  }
  // "2,000 users" is not the year 2000, and "5k users" is not 5: both are counts the documents must hold.
  for (const { raw, n, percent, plain } of numberTokens(text)) {
    if (!percent && Number(n) < 10) continue;
    if (plain && /^(19|20)\d\d$/.test(n)) continue;
    if (!rules.known.has(n)) issues.push(`It says ${raw}, a number that is not in your documents.`);
  }
  return issues;
}

/** `limit` and `platform` come from the post's profile; X when not given. */
export function checkPost(text: string, rules: CheckRules, profile: { limit: number; platform: string } = { limit: X_LIMIT, platform: "X" }): string[] {
  const t = text.trim();
  if (!t) return ["The post is empty."];
  const issues: string[] = [];
  // X counts links as 23 and emojis, CJK and accented Vietnamese as 2 (`xLength`); the larger count keeps every
  // post the 280-character thread schemas take.
  const length = profile.platform === "X" ? Math.max([...t].length, xLength(t)) : [...t].length;
  if (length > profile.limit) issues.push(`It is ${length} characters; ${profile.platform} allows ${profile.limit}.`);
  issues.push(...factIssues(t, rules));
  if (hasLink(t, rules.names)) issues.push("It has a link. Posts carry no links.");
  if (hashtagCount(t)) issues.push("It has a hashtag. Posts carry no hashtags; they go only on video captions.");
  issues.push(...slopIssues(t, rules.allowSlop));
  if (rules.noProduct) {
    const named = (rules.names ?? []).find((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t));
    if (named) issues.push(`It names ${named}, and the brief asks for no product pitch. Help the reader without the product.`);
  }
  return issues;
}
