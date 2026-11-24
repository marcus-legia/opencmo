/**
 * Who is ready for a DM or an email (redesign plan, "Who is ready for a DM or an email", owner 2026-11-19). One check
 * for every platform, read from the person's own post and its thread only; Ferreto never reads or keeps a profile.
 * Pure: the browser imports it too.
 *
 * Reply first is the default. Every card already holds someone describing the problem (it scored with a quote), so a
 * DM needs only three things (owner, 2026-11-24, after the five-check gate blocked the right people): the author is not
 * selling to the same people, the place allows DMs, and the post is recent. Wants it now, warm and asking for tools
 * order who to message first; they no longer lock the DM.
 * Email ready = DM ready + an address the person published in the post, the thread or the business site it links.
 */
import { z } from "zod";

import type { SalesPlatform } from "./social/conversations";

export const REACH_LEVELS = ["reply_first", "dm_ready", "email_ready"] as const;
export type ReachLevel = (typeof REACH_LEVELS)[number];

export const PERSON_STATUSES = ["found", "replied", "answered_back", "talking", "signed_up", "customer", "not_interested"] as const;
export type PersonStatus = (typeof PERSON_STATUSES)[number];

/** A thread counts as fresh for a DM when it was posted less than this long ago. */
export const FRESH_DAYS = 14;
/** At most this many DM drafts a day per founder (wave 3 §9): it keeps reaching out personal. */
export const DM_DRAFTS_PER_DAY = 20;
/** Days without an answer before a nudge is drafted (redesign plan, "Reaching out"). */
export const NUDGE_AFTER_DAYS = 4;

/** Platforms with private messages at all. Hacker News has none, so nobody there is ever DM ready. */
export const DM_PLATFORMS: readonly SalesPlatform[] = ["reddit", "facebook", "threads"];

export const ReachCheckSchema = z.object({
  /** Not selling to the founder's customers: false for a vendor, an agency, a freelancer offering a service, or a thread the scan excluded. */
  buyer: z.boolean(),
  /** Wants it now (the scan's evidence quote). */
  wantsNow: z.boolean(),
  /** Answered the founder's public reply, still active in the thread, or wrote "DM me / email me". */
  warm: z.boolean(),
  /** Posted less than `FRESH_DAYS` ago. */
  fresh: z.boolean(),
  /** The platform has DMs and the community's rules allow them. */
  dmAllowed: z.boolean(),
  /** The post asks for tools or recommendations: puts the person higher in who to message first. */
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
  if (!(check.buyer && check.fresh && check.dmAllowed)) return "reply_first";
  return check.emailFound ? "email_ready" : "dm_ready";
}

export const REACH_LEVEL_LABEL: Record<ReachLevel, string> = { reply_first: "Reply first", dm_ready: "DM ready", email_ready: "Email ready" };

/**
 * The one line a card shows beside its level (wave 4 B3). It is the scan's own reason for the check that decided it:
 * for Reply first, the first check that failed; for DM ready, the strongest sign (an answer, a post asking for tools,
 * or the problem itself); for Email ready, the address. Reasons are in `reachFor`'s order: buyer, wants it now, warm,
 * fresh, DMs, email. No reason written means the level's own plain line.
 */
export function reachReason(level: ReachLevel, check: ReachCheck | null): string {
  const r = check?.reasons ?? [];
  const pick = (i: number, fallback: string) => (r[i]?.trim() ? r[i]!.trim() : fallback);
  if (!check) return "Reply in public first.";
  if (level === "email_ready") return pick(5, "They published an address.");
  if (level === "dm_ready") {
    if (check.warm) return pick(2, "They answered you.");
    return check.asksForTools ? "The post asks for tools or recommendations." : "They describe the problem you solve.";
  }
  const failed: [boolean, number, string][] = [
    [check.buyer, 0, "Sells to the same people you do."],
    [check.fresh, 3, `Posted more than ${FRESH_DAYS} days ago.`],
    [check.dmAllowed, 4, "No private messages here."],
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
