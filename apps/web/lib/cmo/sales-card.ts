/**
 * Lines a Sales card shows, kept out of the component so they can be checked (`sales-card.check.ts`). Pure.
 */
import { FRESH_DAYS } from "./reach";
import type { SalesScreen } from "../screens/sales";

type Thread = SalesScreen["threads"][number];

/**
 * What the community allows, as one badge the founder reads before writing (owner, 2026-11-23: "help only, don't
 * promote, DM them later"). The rule reader's own line stays under it for the detail.
 */
export function ruleHeadline(t: Pick<Thread, "rule" | "platform" | "person">): string {
  const dmLater = t.platform !== "hn" && t.person?.reach?.dmAllowed !== false;
  switch (t.rule.kind) {
    case "mention_allowed":
      return "You may name your product once";
    case "requires_disclosure":
      return "You may name it · say it's yours";
    case "skipped":
      return "Don't reply here";
    default:
      return dmLater ? "Help only · don't promote · DM them later" : "Help only · don't promote";
  }
}

/** Days since a thread was posted when that is past the DM window (owner test 2026-11-23: 22- and 27-day threads). */
export function oldDays(postedAt: string | null, now = Date.now()): number | null {
  const at = postedAt ? Date.parse(postedAt) : NaN;
  if (Number.isNaN(at)) return null;
  const days = Math.floor((now - at) / 86_400_000);
  return days >= FRESH_DAYS ? days : null;
}

