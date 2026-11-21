/**
 * Who is ready for a DM or an email (redesign plan, "Who is ready for a DM or an email", owner 2026-11-19). One check
 * for every platform, read from the person's own post and its thread only; Ferreto never reads or keeps a profile.
 * Pure: the browser imports it too.
 *
 * Reply first is the default. DM ready = a buyer, wants it now, fresh, a DM path, and warm or a post asking for tools.
 * Email ready = DM ready + an address found in the post, the thread or the business site it links + warm.
 */
import { z } from "zod";

import type { SalesPlatform } from "./social/conversations";

export const REACH_LEVELS = ["reply_first", "dm_ready", "email_ready"] as const;
export type ReachLevel = (typeof REACH_LEVELS)[number];

export const PERSON_STATUSES = ["found", "replied", "answered_back", "talking", "signed_up", "customer", "not_interested"] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

/** A thread counts as fresh for a DM when it was posted less than this long ago. */
export const FRESH_DAYS = 7;
/** At most this many DM drafts a day per founder (wave 3 §9): it keeps reaching out personal. */
export const DM_DRAFTS_PER_DAY = 20;
/** Days without an answer before a nudge is drafted (redesign plan, "Reaching out"). */
export const NUDGE_AFTER_DAYS = 4;

/** Platforms with private messages at all. Hacker News has none, so nobody there is ever DM ready. */
export const DM_PLATFORMS: readonly SalesPlatform[] = ["reddit", "facebook", "threads"];

export const ReachCheckSchema = z.object({
  /** A buyer like the founder's customers, in their own words; vendors and unclear authors are false. */
  buyer: z.boolean(),
  /** Wants it now (the scan's evidence quote). */
  wantsNow: z.boolean(),
  /** Answered the founder's public reply, still active in the thread, or wrote "DM me / email me". */
  warm: z.boolean(),
  /** Posted less than `FRESH_DAYS` ago. */
  fresh: z.boolean(),
  /** The platform has DMs and the community's rules allow them. */
  dmAllowed: z.boolean(),
  /** The post asks for tools or recommendations: enough in place of `warm` for a DM, never for an email. */
  asksForTools: z.boolean(),
  /** An address the person published in the post or thread, or on the business site the post links. */
  emailFound: z.email().max(254).nullable(),
  /** One short line per check, for the screen. */
  reasons: z.array(z.string().trim().min(1).max(160)).max(8),
});
export type ReachCheck = {
  buyer: boolean;
  wantsNow: boolean;
  warm: boolean;
  fresh: boolean;
  dmAllowed: boolean;
  asksForTools: boolean;
  emailFound: string | null;
  reasons: string[];
};

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _checkSame: Same<z.infer<typeof ReachCheckSchema>, ReachCheck> = true;
void _checkSame;

export function reachLevel(check: ReachCheck): ReachLevel {
  const dmReady = check.buyer && check.wantsNow && check.fresh && check.dmAllowed && (check.warm || check.asksForTools);
  if (!dmReady) return "reply_first";
  return check.emailFound && check.warm ? "email_ready" : "dm_ready";
}

export const REACH_LEVEL_LABEL: Record<ReachLevel, string> = { reply_first: "Reply first", dm_ready: "DM ready", email_ready: "Email ready" };

/**
 * The one line a card shows beside its level (wave 4 B3). It is the scan's own reason for the check that decided it:
 * for Reply first, the first check that failed; for DM ready, what made it warm enough (an answer, or a post asking
 * for tools); for Email ready, the address. Reasons are in `checksOf`'s order: buyer, wants it now, warm, fresh, DMs,
 * email. No reason written means the level's own plain line.
 */
export function reachReason(level: ReachLevel, check: ReachCheck | null): string {
  const r = check?.reasons ?? [];
  const pick = (i: number, fallback: string) => (r[i]?.trim() ? r[i]!.trim() : fallback);
  if (!check) return "Reply in public first.";
  if (level === "email_ready") return pick(5, "They published an address and answered you.");
  if (level === "dm_ready") return check.warm ? pick(2, "They answered you.") : "The post asks for tools or recommendations.";
  const failed: [boolean, number, string][] = [
    [check.buyer, 0, "Not clearly a buyer like your customers."],
    [check.wantsNow, 1, "No sign they want it now."],
    [check.fresh, 3, `Posted more than ${FRESH_DAYS} days ago.`],
    [check.dmAllowed, 4, "No private messages here."],
    [check.warm || check.asksForTools, 2, "Not warm yet: reply in public first."],
  ];
  const first = failed.find(([ok]) => !ok);
  return first ? pick(first[1], first[2]) : "Reply in public first.";
}

/** Whether a thread posted at `postedAt` is still fresh at `now`. An unknown date is not fresh. */
export function isFresh(postedAt: string | null, now: Date = new Date()): boolean {
  if (!postedAt) return false;
  const at = Date.parse(postedAt);
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  return age >= 0 && age < FRESH_DAYS * 24 * 60 * 60 * 1000;
}

/** Whether the platform can carry a DM at all; the community rule is read on top of this. */
export function platformHasDms(platform: SalesPlatform): boolean {
  return DM_PLATFORMS.includes(platform);
}

/** Authors no one can be told apart by: never deduped (as `cmo_save_opportunities`, 20270204010000). */
const NO_PERSON = new Set(["", "[deleted]", "[removed]", "u/[deleted]", "u/[removed]"]);

/**
 * One key per person (review 2026-11-21): the platform and the author's handle, trimmed and lower-cased, the way SQL
 * compares them. Null for an author we cannot tell apart, who is never deduped.
 */
export function personKey(platform: SalesPlatform, author: string | null | undefined): string | null {
  const handle = (author ?? "").slice(0, 100).trim().toLowerCase();
  return NO_PERSON.has(handle) ? null : `${platform}:${handle}`;
}

/** One reach check the scan hands `cmo_save_reach`, keyed by the thread's url; `dm` only for a DM-ready person. */
export type ReachSaveItem = { url: string; level: ReachLevel; reach: ReachCheck; dm?: string };
