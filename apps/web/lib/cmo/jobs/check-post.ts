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

import { normalizeNumber } from "./context";

export const X_LIMIT = 280;

export type CheckRules = { avoid: string[]; known: Set<string> };

/** A URL, a `www.` address, or a bare domain on a TLD people link to ("opencmo.io/pricing"); not "Next.js". */
const LINK = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+|\b[a-z0-9][a-z0-9-]*\.(?:com|io|ai|co|app|dev|net|org|so|xyz|me|ly|gg|sh|to|tv|link|site|online|store|tech|page|info|biz|us|uk)\b(?!\.\w)/i;

export const hasLink = (text: string): boolean => LINK.test(text);
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
  for (const raw of text.match(/\d[\d,.]*%?/g) ?? []) {
    const isPercent = raw.endsWith("%");
    const n = normalizeNumber(raw.replace(/%$/, ""));
    if (!isPercent && Number(n) < 10) continue;
    if (/^(19|20)\d\d$/.test(n)) continue;
    if (!rules.known.has(n)) issues.push(`It says ${raw}, a number that is not in your documents.`);
  }
  return issues;
}

/** `limit` and `platform` come from the post's profile; X when not given. */
export function checkPost(text: string, rules: CheckRules, profile: { limit: number; platform: string } = { limit: X_LIMIT, platform: "X" }): string[] {
  const t = text.trim();
  if (!t) return ["The post is empty."];
  const issues: string[] = [];
  const length = [...t].length;
  if (length > profile.limit) issues.push(`It is ${length} characters; ${profile.platform} allows ${profile.limit}.`);
  issues.push(...factIssues(t, rules));
  if (hasLink(t)) issues.push("It has a link. Posts carry no links.");
  if (hashtagCount(t)) issues.push("It has a hashtag. Posts carry no hashtags; they go only on video captions.");
  return issues;
}
