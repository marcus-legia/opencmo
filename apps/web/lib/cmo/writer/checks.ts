/**
 * Code checks per writer kind, run before a draft reaches a card: limits from the platform profile, the
 * strategy's words to avoid, numbers that must be in the documents, links only where the profile allows
 * them, and hashtags only on captions and YouTube text, at most the profile's count. A post goes through
 * `checkPost` (no links and no hashtags at all).
 *
 * Facts and product rules only: No AI Slop is advice in the prompt, never a check here.
 */

import { checkPost, factIssues, hashtagCount, hasLink, type CheckRules } from "../jobs/check-post";
import { slopIssues } from "../slop";
import { SCRIPT_BEATS, SCRIPT_CAPTION, type CaptionDraft, type VideoBrief, type WriterProfile, type YoutubeDraft } from "./types";

const chars = (text: string) => [...text].length;

/** "buildinpublic", "#buildinpublic" and "#build in public" are one tag; empty ones are dropped. */
export function cleanHashtags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((tag) => tag && /\p{L}/u.test(tag) && !seen.has(tag.toLowerCase()) && (seen.add(tag.toLowerCase()), true));
}

/** The caption as it is published: the text, then its hashtags on their own line. */
export function captionText(draft: Pick<CaptionDraft, "text" | "hashtags">): string {
  const tags = cleanHashtags(draft.hashtags);
  return tags.length ? `${draft.text.trim()}\n\n${tags.map((tag) => `#${tag}`).join(" ")}` : draft.text.trim();
}

function tagIssues(text: string, tags: readonly string[], profile: WriterProfile): string[] {
  const count = hashtagCount(text) + cleanHashtags(tags).length;
  if (count <= profile.hashtags) return [];
  return [profile.hashtags ? `It has ${count} hashtags; the ${profile.label} takes at most ${profile.hashtags}.` : `It has a hashtag; the ${profile.label} takes none.`];
}

const linkIssues = (text: string, profile: WriterProfile, rules: CheckRules): string[] =>
  !profile.links && hasLink(text, rules.names) ? [`It has a link; the ${profile.label} takes none.`] : [];

export function checkPostFor(text: string, profile: WriterProfile, rules: CheckRules): string[] {
  return checkPost(text, rules, { limit: profile.limit, platform: profile.label });
}

/**
 * Advice for the fix round, never a reason to drop a version: on a platform that cuts a post at "more" (LinkedIn),
 * the first line should end before the cut so the hook is read.
 */
export function moreAdvice(text: string, profile: WriterProfile): string[] {
  const cut = profile.visibleBeforeMore;
  const first = text.trim().split("\n")[0] ?? "";
  if (!cut || chars(first) <= cut) return [];
  return [`The first line is ${chars(first)} characters; ${profile.label} shows about ${cut} before "more", so the hook should land sooner.`];
}

/** The published caption (text and hashtags together) must fit the profile's limit. */
export function checkCaption(draft: Pick<CaptionDraft, "text" | "hashtags">, profile: WriterProfile, rules: CheckRules): string[] {
  const text = draft.text.trim();
  if (!text) return ["The caption is empty."];
  const full = captionText(draft);
  return [
    ...(chars(full) > profile.limit ? [`It is ${chars(full)} characters; the ${profile.label} allows ${profile.limit}.`] : []),
    ...factIssues(text, rules),
    ...linkIssues(text, profile, rules),
    ...tagIssues(text, draft.hashtags, profile),
    ...slopIssues(text, rules.allowSlop),
  ];
}

export function checkYoutube(draft: Pick<YoutubeDraft, "title" | "description" | "hashtags">, profile: WriterProfile, rules: CheckRules): string[] {
  const title = draft.title.trim();
  const description = draft.description.trim();
  if (!title || !description) return [title ? "The description is empty." : "The title is empty."];
  const titleLimit = profile.title ?? 100;
  const full = captionText({ text: description, hashtags: draft.hashtags });
  return [
    ...(chars(title) > titleLimit ? [`The title is ${chars(title)} characters; YouTube allows ${titleLimit}.`] : []),
    ...(chars(full) > profile.limit ? [`The description is ${chars(full)} characters; YouTube allows ${profile.limit}.`] : []),
    ...(hashtagCount(title) ? ["The title has a hashtag; hashtags go in the description."] : []),
    ...factIssues(`${title}\n${description}`, rules),
    ...linkIssues(`${title}\n${description}`, profile, rules),
    ...tagIssues(description, draft.hashtags, profile),
    ...slopIssues(title, rules.allowSlop).map((issue) => `The title: ${issue}`),
    ...slopIssues(description, rules.allowSlop).map((issue) => `The description: ${issue}`),
  ];
}

/** The caption written with a script: there, within the limit, at most five hashtags, no link, no invented fact. */
export function checkScriptCaption(caption: string, rules: CheckRules): string[] {
  const text = caption.trim();
  if (!text) return ["It has no caption."];
  const tags = hashtagCount(text);
  return [
    ...(chars(text) > SCRIPT_CAPTION.max ? [`The caption is ${chars(text)} characters; a caption is at most ${SCRIPT_CAPTION.max}.`] : []),
    ...(tags > SCRIPT_CAPTION.hashtags ? [`The caption has ${tags} hashtags; it takes at most ${SCRIPT_CAPTION.hashtags}.`] : []),
    ...(hasLink(text, rules.names) ? ["The caption has a link."] : []),
    ...factIssues(text, rules),
    ...slopIssues(text.replace(/#[\p{L}\p{N}_]+/gu, "").trim(), rules.allowSlop).map((issue) => `The caption: ${issue}`),
  ];
}

/** The brief's hooks and key points reach the Director as facts: no invented numbers, no words to avoid. */
export function checkVideoBrief(brief: VideoBrief, rules: CheckRules): string[] {
  const issues: string[] = [];
  if (brief.hooks.length !== 3) issues.push(`It has ${brief.hooks.length} hooks; a brief has 3.`);
  if (!brief.cta) issues.push("It has no call to action.");
  const beats = brief.storyboard;
  if (beats.length < SCRIPT_BEATS.min || beats.length > SCRIPT_BEATS.max) {
    issues.push(`The script has ${beats.length} beats; a script has ${SCRIPT_BEATS.min} to ${SCRIPT_BEATS.max}.`);
  } else {
    const total = beats.reduce((sum, beat) => sum + beat.seconds, 0);
    // A beat's seconds are a guide for recording, so a fifth either way is fine; more and the length is wrong.
    if (Math.abs(total - brief.seconds) > Math.max(5, brief.seconds * 0.2)) issues.push(`The beats run ${total} s; the video is ${brief.seconds} s.`);
    const slow = beats.findIndex((beat) => beat.say.split(/\s+/).filter(Boolean).length > beat.seconds * 3.5);
    if (slow >= 0) issues.push(`Beat ${slow + 1} has more words than can be said in ${beats[slow]!.seconds} s.`);
  }
  issues.push(...factIssues([brief.objective, brief.angle, ...brief.hooks, ...brief.keyPoints, brief.cta, ...beats.map((beat) => `${beat.say}\n${beat.show}`)].join("\n"), rules));
  // What the founder says aloud, line by line: a question inside a script is fine, the other patterns are not.
  const spoken = [...brief.hooks, brief.cta, ...beats.map((beat) => beat.say)];
  const said = new Set(spoken.flatMap((line) => slopIssues(line, new Set([...(rules.allowSlop ?? []), "closing_question"]))));
  issues.push(...[...said].map((issue) => `The script: ${issue}`));
  issues.push(...checkScriptCaption(brief.caption, rules));
  return issues;
}

