import type { WriterScreen } from "@/lib/screens/writer";

type Draft = WriterScreen["drafts"][number];

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Minutes from this Monday 00:00: a draft with a time at that time, one with only a day (still to come this week) at
 * that day's end, one with neither last of all.
 */
export function weekOrder(d: Draft, monday: number): number {
  if (d.at) return Math.round((Date.parse(d.at) - monday) / 60_000);
  const day = WEEKDAYS.indexOf((d.dayText ?? "").slice(0, 3).toLowerCase());
  return day < 0 ? 8 * 1440 : day * 1440 + 1439;
}

/** This Monday, 00:00 on this device. */
export function thisMonday(): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t.getTime();
}

/** This week's drafts in the order they go out. The screen also carries last week's, which are left out. */
export function draftsThisWeek(drafts: Draft[]): Draft[] {
  const monday = thisMonday();
  return drafts.filter((d) => !d.at || Date.parse(d.at) >= monday).sort((a, b) => weekOrder(a, monday) - weekOrder(b, monday));
}
