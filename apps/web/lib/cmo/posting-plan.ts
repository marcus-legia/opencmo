import { z } from "zod";

/**
 * The founder's posting plan: which platforms get a post every day and how many, and how many videos a week.
 * SQL keeps the same bounds in `save_posting_plan` (`profiles.posting_plan`, null = use the default).
 */

// Text platforms the CMO writes a daily core post for, in slot order. Facebook is a Page (D9, 2026-11-12).
export const TEXT_PLATFORMS = ["x", "threads", "linkedin", "facebook"] as const;
export const VIDEO_PLATFORMS = ["tiktok", "instagram", "youtube"] as const;

export type TextPlatform = (typeof TEXT_PLATFORMS)[number];
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

export type PostingPlan = {
  text: Record<TextPlatform, number>; // posts a day, 0–3
  video: Record<VideoPlatform, number>; // videos a week, 0–7
};

function counts<K extends string>(keys: readonly K[], max: number) {
  // A plan saved before Facebook joined has no `facebook`: it reads as 0, not as an unset plan.
  const count = z.number().int().min(0).max(max).default(0);
  return z.object(Object.fromEntries(keys.map((k) => [k, count])) as Record<K, typeof count>);
}

export const PostingPlanSchema = z.object({
  text: counts(TEXT_PLATFORMS, 3),
  video: counts(VIDEO_PLATFORMS, 7),
}) as z.ZodType<PostingPlan>;

/**
 * Connected text platforms and the ones the founder chose in onboarding (the Post plan's `channels`) at 1 a day; X at 1
 * when there are none; video all 0. The chosen channels count because most founders connect nothing before the first
 * week plan: reading only connected accounts planned X alone for a founder who picked X and Threads (2026-11-24).
 */
export function defaultPostingPlan(connected: readonly string[], chosen: readonly string[] = []): PostingPlan {
  const on = TEXT_PLATFORMS.filter((p) => connected.includes(p) || chosen.includes(p));
  const picked = on.length ? on : (["x"] as const);
  return {
    text: Object.fromEntries(TEXT_PLATFORMS.map((p) => [p, (picked as readonly string[]).includes(p) ? 1 : 0])) as PostingPlan["text"],
    video: Object.fromEntries(VIDEO_PLATFORMS.map((p) => [p, 0])) as PostingPlan["video"],
  };
}

/** The core posts of one day: post i targets every platform whose count > i. [] when every count is 0. */
export function dayTargets(plan: PostingPlan): string[][] {
  const most = Math.max(0, ...TEXT_PLATFORMS.map((p) => plan.text[p]));
  const days: string[][] = [];
  for (let i = 0; i < most; i++) days.push(TEXT_PLATFORMS.filter((p) => plan.text[p] > i));
  return days;
}

/**
 * The founder's saved plan, else the default for their connected accounts and chosen channels; a saved value that no
 * longer parses counts as unset.
 */
export function planOrDefault(saved: unknown, connected: readonly string[], chosen: readonly string[] = []): PostingPlan {
  const parsed = PostingPlanSchema.safeParse(saved);
  return parsed.success ? parsed.data : defaultPostingPlan(connected, chosen);
}

/** The Post plan's `channels` as strings; anything else in the document reads as no choice. */
export function chosenChannels(postPlan: unknown): string[] {
  const channels = (postPlan as { channels?: unknown } | null | undefined)?.channels;
  return Array.isArray(channels) ? channels.filter((c): c is string => typeof c === "string") : [];
}
