/**
 * Code checks on a post BEFORE a model check costs money: length, words to avoid, made-up numbers, and
 * the product rules for posts (owner, 2026-10-26, `writer.md` §7): no links and no hashtags in a post;
 * hashtags belong only on video captions. A number of 10 or more, or a percentage, must appear in the
 * founder's documents (no invented numbers).
 *
 * Only facts and product rules live here. Writing style (No AI Slop) is advice the writer and the checker
 * read in a skill, never a check that drops a draft.
 */

import { normalizeNumber } from "./context";

export const X_LIMIT = 280;

/** A URL, a `www.` address, or a bare domain on a TLD people link to ("opencmo.io/pricing"); not "Next.js". */
const LINK = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+|\b[a-z0-9][a-z0-9-]*\.(?:com|io|ai|co|app|dev|net|org|so|xyz|me|ly|gg|sh|to|tv|link|site|online|store|tech|page|info|biz|us|uk)\b(?!\.\w)/i;

/** A hashtag as platforms read it: `#` after a space or the start, with at least one letter ("#buildinpublic", not "#1" or "C#"). */
const HASHTAG = /(?:^|[^\p{L}\p{N}_&/])#(?=[\p{N}_]*\p{L})[\p{L}\p{N}_]+/u;

export function checkPost(text: string, rules: { avoid: string[]; known: Set<string> }): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (!t) return ["The post is empty."];
  if ([...t].length > X_LIMIT) issues.push(`It is ${[...t].length} characters; X allows ${X_LIMIT}.`);
  const lower = t.toLowerCase();
  for (const word of rules.avoid) {
    const w = word.toLowerCase();
    if (w.length >= 3 && lower.includes(w)) issues.push(`It uses "${word}", which your strategy says to avoid.`);
  }
  for (const raw of t.match(/\d[\d,.]*%?/g) ?? []) {
    const isPercent = raw.endsWith("%");
    const n = normalizeNumber(raw.replace(/%$/, ""));
    if (!isPercent && Number(n) < 10) continue;
    if (/^(19|20)\d\d$/.test(n)) continue;
    if (!rules.known.has(n)) issues.push(`It says ${raw}, a number that is not in your documents.`);
  }
  if (LINK.test(t)) issues.push("It has a link. Posts carry no links.");
  if (HASHTAG.test(t)) issues.push("It has a hashtag. Posts carry no hashtags; they go only on video captions.");
  return issues;
}
