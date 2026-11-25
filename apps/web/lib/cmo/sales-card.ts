/**
 * Lines a Sales card shows, kept out of the component so they can be checked (`sales-card.check.ts`). Pure.
 */
import { FRESH_DAYS } from "./reach-window";
import type { SalesScreen } from "../screens/sales";

type Thread = SalesScreen["threads"][number];

/**
 * What the community allows, as one badge the founder reads before writing (owner, 2026-11-23: "help only, don't
 * promote, DM them later"). The rule reader's own line stays under it for the detail.
 */
export function ruleHeadline(t: Pick<Thread, "rule" | "platform" | "person" | "postedAt">, now = Date.now()): string {
  const reach = t.person?.reach;
  // "DM them later" only for someone the DM gate can open: DMs here, not a seller, not an old thread.
  const dmLater = t.platform !== "hn" && reach?.dmAllowed !== false && reach?.buyer !== false && reach?.fresh !== false && oldDays(t.postedAt, now) === null;
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


type Scan = SalesScreen["scans"][number];
export type ScanSection<T> = { key: string; scan: Scan | null; threads: T[] };

const suffix = (no: string | undefined) => Number(no?.split(".")[1] ?? Number.MAX_SAFE_INTEGER);

/**
 * The Sales list as the index's sections (owner, 2026-11-25): one per scan, newest first, its people in their number
 * order (open ones first, then 3.1, 3.2…). A scan that found no one shows as an empty section while it is newer than the
 * oldest one listed, so a run of empty scans reads as such. People from before numbered scans close the list under
 * "Earlier".
 */
export function scanSections<T extends { scanNo?: number; no?: string; status?: string }>(threads: T[], scans: Scan[]): ScanSection<T>[] {
  // Open people first (the ones that still need a reply), then by number.
  const order = (a: T, b: T) => Number(b.status === "open") - Number(a.status === "open") || suffix(a.no) - suffix(b.no);
  const byScan = new Map<number, T[]>();
  const loose: T[] = [];
  for (const t of threads) {
    if (t.scanNo) byScan.set(t.scanNo, [...(byScan.get(t.scanNo) ?? []), t]);
    else loose.push(t);
  }
  const oldestListed = Math.max(...[...byScan.keys()], 0);
  const sections: ScanSection<T>[] = [];
  const known = new Set<number>();
  // Scan #1 is the newest: sections in number order put it on top.
  for (const scan of [...scans].sort((a, b) => a.no - b.no)) {
    known.add(scan.no);
    const list = (byScan.get(scan.no) ?? []).sort(order);
    // An empty section only for a scan that found no one: one whose people are just not loaded is left out.
    const emptyRun = scan.verdict === "none" && oldestListed > 0 && scan.no < oldestListed;
    if (list.length || emptyRun) sections.push({ key: `scan-${scan.no}`, scan, threads: list });
  }
  // A scan the list has people from but the scans read did not return (it is older than the ones kept).
  for (const [no, list] of [...byScan].sort((a, b) => a[0] - b[0])) {
    if (!known.has(no)) sections.push({ key: `scan-${no}`, scan: { no, at: "", cards: list.length, verdict: "found" }, threads: list.sort(order) });
  }
  if (loose.length) sections.push({ key: "earlier", scan: null, threads: loose });
  return sections;
}
