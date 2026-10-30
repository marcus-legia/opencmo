/**
 * Schedule card helpers (P4 C0): times are shown and picked in the founder's timezone (`profiles.timezone`), never
 * the browser's, and sent back in UTC the way `approval_snapshot('schedule_slot')` stores them.
 */

import type { ApprovalCard, ScheduleOptions } from "@/lib/screens/approval-card";
import type { Platform } from "@/lib/screens/common";

type Body = Extract<ApprovalCard["body"], { kind: "schedule" }>;

export { formatWhen, fromLocalInput, toLocalInput } from "@/lib/time-zone";

/** TikTok's privacy levels (creator info), as the selector names them. */
export const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

/** Platforms whose posting API takes an AI-generated label (TikTok `is_aigc`, YouTube "altered or synthetic content"). */
export const AI_LABEL_PLATFORMS: ReadonlySet<Platform> = new Set(["tiktok", "youtube"]);

export const TIKTOK_MUSIC_TERMS = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";

/** Option keys in a fixed order, so two option sets compare the same whatever order their keys came in. */
const OPTION_KEYS = ["privacy", "allow_comment", "allow_duet", "allow_stitch", "brand_organic", "brand_content", "ai_label"] as const;

export function sameOptions(a: ScheduleOptions, b: ScheduleOptions): boolean {
  return OPTION_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

const isTikTok = (body: Body) => body.mode === "publish" && body.where.platform === "tiktok";

/**
 * The fields as they are saved: on TikTok every toggle the card showed is sent as on or off, because approving needs
 * the founder's answer for each (`schedule_ready_check`), and one left untouched means off, never a default on.
 */
export function savedOptions(body: Body, options: ScheduleOptions): ScheduleOptions {
  if (!isTikTok(body) || !body.tiktok) return options;
  return {
    ...options,
    allow_comment: !body.tiktok.commentDisabled && !!options.allow_comment,
    allow_duet: !body.tiktok.duetDisabled && !!options.allow_duet,
    allow_stitch: !body.tiktok.stitchDisabled && !!options.allow_stitch,
    brand_organic: !!options.brand_organic,
    brand_content: !!options.brand_content,
  };
}

/**
 * Why Approve cannot go yet, or null. TikTok's posting guidelines want the founder to pick the audience and the
 * interactions themselves: nothing is chosen for them.
 */
export function approveBlocked(body: Body, options: ScheduleOptions): string | null {
  if (!sameOptions(options, body.options)) return "Save your changes first: the card asks you again with them.";
  if (!isTikTok(body)) return null;
  if (!body.tiktok) return "TikTok's settings for this account could not be read. Reload the card in a minute.";
  if (!options.privacy || typeof options.allow_comment !== "boolean") return "Choose who can see it on TikTok and save first.";
  if (options.brand_content && options.privacy === "SELF_ONLY") return "Branded content cannot be private on TikTok: choose who can see it.";
  return null;
}
