/**
 * Platform profiles (`packages/contracts/platforms.json`, writer.md §7): what Writer may write for each platform.
 * Writer's prompt, the code checks, the cards and SQL's `platform_profile()` read the same numbers.
 *
 * Pure module: client cards import it for the limit counter, the "more" marker and the hashtag count.
 */

import { z } from "zod";

import data from "../../../../packages/contracts/platforms.json";
import { PlatformSchema } from "../screens/common";

export const PROFILE_KINDS = ["post", "caption", "youtube"] as const;

export const PlatformProfileSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z_]{0,19}$/),
    label: z.string().min(1).max(40),
    platform: PlatformSchema,
    kind: z.enum(PROFILE_KINDS),
    limit: z.number().int().min(1).max(10000),
    title: z.number().int().min(1).max(500).nullable(),
    visibleBeforeMore: z.number().int().min(1).nullable(),
    hashtags: z.number().int().min(0).max(30),
    links: z.literal(false),
    tone: z.string().min(1).max(200),
  })
  .strict();
export type PlatformProfile = z.infer<typeof PlatformProfileSchema>;

export const PlatformsFileSchema = z
  .object({ $schema: z.string().optional(), $comment: z.string().optional(), profiles: z.array(PlatformProfileSchema).min(1) })
  .strict();

export const PROFILES: readonly PlatformProfile[] = PlatformsFileSchema.parse(data).profiles;

const BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

/** The profile with this id, or null for an unknown one (an old row's free-text platform). */
export function profileOf(id: string): PlatformProfile | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The profile a calendar label names (`content_items.platform`: the plan writes "X", "LinkedIn", "Reels", "Shorts")
 * or a profile id itself; null for Reddit and anything unknown. SQL's `platform_profile_id` maps the same labels
 * (check:contracts compares them).
 */
export const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  x: "x",
  twitter: "x",
  threads: "threads",
  linkedin: "linkedin",
  instagram: "instagram_caption",
  instagram_caption: "instagram_caption",
  reels: "instagram_caption",
  tiktok: "tiktok_caption",
  tiktok_caption: "tiktok_caption",
  youtube: "youtube",
  shorts: "youtube",
  "youtube shorts": "youtube",
};

export function profileIdOf(label: string | null | undefined): string | null {
  if (typeof label !== "string") return null;
  return PLATFORM_LABELS[label.trim().toLowerCase()] ?? null;
}

/** The profiles Writer drafts posts for, in the file's order: X, Threads, LinkedIn. */
export const POST_PROFILES = PROFILES.filter((p) => p.kind === "post");
/** The profiles a video or short gets words for: captions and the YouTube title and description. */
export const CAPTION_PROFILES = PROFILES.filter((p) => p.kind !== "post");

const HASHTAG = /(?:^|[^\p{L}\p{N}_&/])#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*/gu;

/** Hashtags in a text the way the platforms count them: `#word` with a letter in it, not `#1` or `a#b`. */
export function countHashtags(text: string): number {
  return text.match(HASHTAG)?.length ?? 0;
}
