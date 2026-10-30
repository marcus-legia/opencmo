/**
 * Schedule card helpers (P4 C0): times are shown and picked in the founder's timezone (`profiles.timezone`), never
 * the browser's, and sent back in UTC the way `approval_snapshot('schedule_slot')` stores them.
 */

import type { ApprovalCard, ScheduleOptions } from "@/lib/screens/approval-card";
import type { Platform } from "@/lib/screens/common";

type Body = Extract<ApprovalCard["body"], { kind: "schedule" }>;

/** Wall-clock parts of `t` in `timezone`. */
function wall(t: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** `YYYY-MM-DDTHH:MM` as a `datetime-local` input wants it, in `timezone`. */
export function toLocalInput(iso: string, timezone: string): string {
  const { date, time } = wall(new Date(iso).getTime(), timezone);
  return `${date}T${time}`;
}

const offsetAt = (t: number, timezone: string) => {
  const { date, time } = wall(t, timezone);
  return Date.parse(`${date}T${time}:00Z`) - Math.floor(t / 60_000) * 60_000;
};

/**
 * A `datetime-local` value read in `timezone` → UTC `YYYY-MM-DDTHH:MM:SSZ`. The offset is taken twice so a time next
 * to a DST change lands on the offset that applies at the result, not at the guess.
 */
export function fromLocalInput(value: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const guess = Date.parse(`${value}:00Z`);
  if (Number.isNaN(guess)) return null;
  const first = guess - offsetAt(guess, timezone);
  const t = guess - offsetAt(first, timezone);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "Thu 29 Oct, 18:00" in the founder's zone. */
export function formatWhen(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

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
const OPTION_KEYS = ["privacy", "allow_comment", "allow_duet", "allow_stitch", "ai_label"] as const;

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
  return null;
}
