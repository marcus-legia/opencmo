/**
 * Today (CMO review 3, plan §3 item 1.1): the short list at the top of the Dashboard and of the morning email.
 *
 * Worked out on the server from rows we already keep (waiting cards, today's slots, what went out per platform, the
 * first run), with no table of its own and nothing kept in the browser, so every device shows the same day. Okara keeps
 * its list in localStorage; ours survives a second device.
 *
 * Pure: no database, no clock of its own. `today-input.ts` reads the rows; the Dashboard loader and the digest call
 * `buildToday` with them. The ranking is deterministic and calls no model.
 */

import { localDay } from "@/lib/time-zone";

import type { Department } from "@/lib/screens/common";

/** At most this many rows; the rest are counted as "N more waiting". */
export const TODAY_MAX_ROWS = 5;
/** Days without a post on a platform the founder posts on: High from 2, Critical from 7. */
export const SILENT_HIGH_DAYS = 2;
export const SILENT_CRITICAL_DAYS = 7;

/** Platforms a Today row can name: the ones the founder posts on by hand or through publishing. */
export const TODAY_PLATFORMS = ["x", "threads", "linkedin", "tiktok", "youtube", "instagram"] as const;
export type TodayPlatform = (typeof TODAY_PLATFORMS)[number];

export const TODAY_REASONS = ["failed_post", "silent", "expiring", "setup", "first_run", "waiting"] as const;
export type TodayReason = (typeof TODAY_REASONS)[number];

export type TodayAction =
  /** Opens the waiting card in place, with the actions it has today. */
  | { type: "card"; approvalId: string; label: string }
  /** Opens the CMO chat with the request filled in; the chat shows its price card as usual. */
  | { type: "chat"; prompt: string; label: string }
  /** A page in the app (`/app/...`). */
  | { type: "link"; href: string; label: string };

export type TodayRow = {
  /** Stable across reads, for React keys and e2e: `card:<id>`, `silent:x`, `first_run:strategy`… */
  id: string;
  reason: TodayReason;
  level: "critical" | "high" | "normal";
  title: string;
  detail: string | null;
  department: Department;
  platform: TodayPlatform | null;
  action: TodayAction;
};

export type Today = {
  /** At most `TODAY_MAX_ROWS`, most urgent first. */
  rows: TodayRow[];
  /** Cards the founder decided today, in their time zone. */
  done: number;
  /** `done` plus every open row, shown or not: "N of M done". */
  total: number;
  /** Open rows cut from the list: "N more waiting". */
  more: number;
};

/** A waiting card, as much of it as Today needs. */
export type TodayCard = {
  id: string;
  kind: string;
  department: Department;
  title: string;
  platform: TodayPlatform | null;
  raisedAt: string;
  expiresAt: string | null;
};

/** A slot of today that failed and has a waiting Retry card (still inside its window). */
export type TodayFailedSlot = { id: string; platform: TodayPlatform; title: string; at: string; approvalId: string };

export type TodayInput = {
  now: Date;
  timezone: string;
  /** Waiting cards, any order. */
  cards: TodayCard[];
  /** Cards decided (approved, edited, skipped) since the founder's local midnight. */
  decidedToday: number;
  failedSlots: TodayFailedSlot[];
  /**
   * The last post per platform the founder posts on (published, or "I posted it"). A platform with no post at all is
   * left out: a new founder gets the first-run rows, not a wall of "nothing posted".
   */
  lastPosted: { platform: TodayPlatform; at: string }[];
  /** Platforms with a post already on its way (a slot between now and the end of tomorrow): not silent. */
  upcoming?: TodayPlatform[];
  /**
   * Platforms with a post going out tomorrow and no connected account. Only filled when the publish adapter is
   * configured: without it, posting by intent works and there is nothing to connect.
   */
  needsAccount: TodayPlatform[];
  firstRun: {
    /** The strategy document exists and the founder has not decided a card yet. */
    readStrategy: boolean;
    /** Session A's `rateDraftsPending`: the first drafts exist and have not been rated. */
    rateDrafts: boolean;
  };
};

export const PLATFORM_LABEL: Record<TodayPlatform, string> = {
  x: "X",
  threads: "Threads",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
};

/** A platform as the rows spell it (`X`, `LinkedIn`, `x`, `twitter`…) to a Today platform, or null. */
export function todayPlatform(value: unknown): TodayPlatform | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (key === "twitter") return "x";
  return (TODAY_PLATFORMS as readonly string[]).includes(key) ? (key as TodayPlatform) : null;
}

/**
 * The founder's zone if `Intl` knows it, else UTC. `profiles.timezone` is only length-checked, and an unknown zone
 * makes `Intl` throw, which would drop Today for that founder.
 */
export function safeZone(timezone: string | null | undefined): string {
  try {
    if (!timezone) return "UTC";
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/** Whole local days between two instants in `timezone` (`later` minus `earlier`). */
export function daysBetween(earlier: Date | string, later: Date, timezone: string): number {
  const zone = safeZone(timezone);
  const a = Date.parse(`${localDay(new Date(earlier), zone)}T00:00:00Z`);
  const b = Date.parse(`${localDay(later, zone)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The post card a silent platform's row opens, or the chat request when none waits. */
function silentRow(platform: TodayPlatform, days: number, post: TodayCard | undefined): TodayRow {
  const name = PLATFORM_LABEL[platform];
  return {
    id: `silent:${platform}`,
    reason: "silent",
    level: days >= SILENT_CRITICAL_DAYS ? "critical" : "high",
    title: `${name}: nothing posted for ${plural(days, "day", "days")}`,
    detail: post ? `A post for ${name} is waiting: “${post.title}”` : null,
    department: "writer",
    platform,
    action: post
      ? { type: "card", approvalId: post.id, label: "Open the post" }
      : { type: "chat", prompt: `Write me a post for ${name} for today.`, label: "Ask your CMO for a post" },
  };
}

function cardRow(card: TodayCard, reason: TodayReason, detail: string | null): TodayRow {
  return {
    id: `card:${card.id}`,
    reason,
    level: "normal",
    title: card.title,
    detail,
    department: card.department,
    platform: card.platform,
    action: { type: "card", approvalId: card.id, label: "Open" },
  };
}

const byAge = (a: TodayCard, b: TodayCard) => a.raisedAt.localeCompare(b.raisedAt) || a.id.localeCompare(b.id);

/**
 * The day's list. Ranking (plan §3, 1.1):
 *   1. a failed post still inside its window;
 *   2. Critical silence (7+ days);
 *   3. a card that expires today;
 *   4. setup that blocks tomorrow's post (only with publishing configured);
 *   5. first-run rows;
 *   6. High silence (2+ days);
 *   7. the oldest waiting cards, one per kind until every kind has had a row.
 * A card is shown once: the row that ranks highest takes it.
 */
export function buildToday(input: TodayInput): Today {
  const { now } = input;
  const timezone = safeZone(input.timezone);
  const today = localDay(now, timezone);
  const taken = new Set<string>();
  const ranked: TodayRow[] = [];
  const push = (row: TodayRow, cardId?: string) => {
    if (cardId) {
      if (taken.has(cardId)) return;
      taken.add(cardId);
    }
    ranked.push(row);
  };
  const cards = [...input.cards].sort(byAge);
  const cardIds = new Set(cards.map((card) => card.id));

  // 1. Failed posts with a Retry card.
  for (const slot of [...input.failedSlots].sort((a, b) => a.at.localeCompare(b.at))) {
    if (!cardIds.has(slot.approvalId)) continue;
    push(
      {
        id: `failed:${slot.id}`,
        reason: "failed_post",
        level: "critical",
        title: `${PLATFORM_LABEL[slot.platform]}: today's post did not go out`,
        detail: slot.title,
        department: "publish",
        platform: slot.platform,
        action: { type: "card", approvalId: slot.approvalId, label: "Retry or post it yourself" },
      },
      slot.approvalId,
    );
  }

  // Silence, per platform; a waiting post for that platform is the row's action.
  const upcoming = new Set(input.upcoming ?? []);
  const silent = input.lastPosted
    .filter(({ platform }) => !upcoming.has(platform))
    .map(({ platform, at }) => ({ platform, days: daysBetween(at, now, timezone) }))
    .filter(({ days }) => days >= SILENT_HIGH_DAYS)
    .sort((a, b) => b.days - a.days || a.platform.localeCompare(b.platform));
  const postFor = (platform: TodayPlatform) => cards.find((card) => card.kind === "post" && card.platform === platform && !taken.has(card.id));
  const silentRows = (critical: boolean) => {
    for (const { platform, days } of silent) {
      if ((days >= SILENT_CRITICAL_DAYS) !== critical) continue;
      const post = postFor(platform);
      push(silentRow(platform, days, post), post?.id);
    }
  };

  // 2. Critical silence.
  silentRows(true);

  // 3. Cards that expire today, soonest first.
  for (const card of cards
    // Already past its time: the expiry sweep takes it, and a decision would fail, so it is not "expiring today".
    .filter((card) => card.expiresAt && Date.parse(card.expiresAt) > now.getTime() && localDay(new Date(card.expiresAt), timezone) <= today)
    .sort((a, b) => (a.expiresAt ?? "").localeCompare(b.expiresAt ?? ""))) {
    push(cardRow(card, "expiring", "Decide it today, or it expires."), card.id);
  }

  // 4. Setup that blocks tomorrow's post.
  for (const platform of [...new Set(input.needsAccount)].sort()) {
    push({
      id: `setup:${platform}`,
      reason: "setup",
      level: "high",
      title: `Connect ${PLATFORM_LABEL[platform]} so tomorrow's post can go out`,
      detail: null,
      department: "publish",
      platform,
      action: { type: "link", href: "/app/settings#settings-connected-accounts", label: `Connect ${PLATFORM_LABEL[platform]}` },
    });
  }

  // 5. The first run.
  if (input.firstRun.readStrategy) {
    push({
      id: "first_run:strategy",
      reason: "first_run",
      level: "normal",
      title: "Ready to read: your marketing strategy",
      detail: "Your CMO wrote it from your website. Edit anything that is wrong; every draft after reads it.",
      department: "brain",
      platform: null,
      action: { type: "link", href: "/app/library?tab=business", label: "Read it" },
    });
  }
  if (input.firstRun.rateDrafts) {
    push({
      id: "first_run:rate",
      reason: "first_run",
      level: "normal",
      title: "Rate your first drafts",
      detail: "Thumbs up or down on a few versions, and your CMO turns them into rules for your voice.",
      department: "writer",
      platform: null,
      action: { type: "link", href: "/app?rate=1", label: "Rate them" },
    });
  }

  // 6. High silence.
  silentRows(false);

  // 7. The rest of the queue, oldest first, one card per kind per round so one busy kind does not fill the list.
  const left = cards.filter((card) => !taken.has(card.id));
  const kinds = [...new Set(left.map((card) => card.kind))];
  const byKind = new Map(kinds.map((kind) => [kind, left.filter((card) => card.kind === kind)]));
  for (let round = 0; byKind.size > 0; round += 1) {
    const heads = [...byKind.entries()].flatMap(([kind, queue]) => {
      const head = queue[round];
      if (!head) byKind.delete(kind);
      return head ? [head] : [];
    });
    for (const card of heads.sort(byAge)) push(cardRow(card, "waiting", null), card.id);
  }

  const rows = ranked.slice(0, TODAY_MAX_ROWS);
  const done = Math.max(0, Math.trunc(input.decidedToday));
  return { rows, done, total: done + ranked.length, more: ranked.length - rows.length };
}

/** "2 of 7 done today", or null when there is nothing to count. */
export function todayCountLine(today: Pick<Today, "done" | "total">): string | null {
  return today.total > 0 ? `${today.done} of ${today.total} done today` : null;
}
