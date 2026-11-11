import type { WriterScreen } from "@/lib/screens/writer";

type Draft = WriterScreen["drafts"][number];

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_MS = 86_400_000;

/** This Monday, 00:00 on this device. */
export function thisMonday(): number {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t.getTime();
}

/** A calendar day ("2026-11-12") at 00:00 on this device. */
function dayStart(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}

/**
 * When a draft is due, at the start of its day or at its exact time; null when it carries neither (an older screen
 * without `day`). The day is what places a draft in a week: the weekday label alone made last week's Thursday post
 * read as this week's (2026-11-11).
 */
function dueAt(d: Draft): number | null {
  if (d.at) return Date.parse(d.at);
  return d.day ? dayStart(d.day) : null;
}

/**
 * Minutes from this Monday 00:00: a draft with a time at that time, one with only a day at that day's end, one with
 * neither last of all.
 */
export function weekOrder(d: Draft, monday: number): number {
  if (d.at) return Math.round((Date.parse(d.at) - monday) / 60_000);
  if (d.day) return Math.round((dayStart(d.day) - monday) / 60_000) + 1439;
  const day = WEEKDAYS.indexOf((d.dayText ?? "").slice(0, 3).toLowerCase());
  return day < 0 ? 8 * 1440 : day * 1440 + 1439;
}

/** This week's drafts (Monday to Sunday) in the order they go out. Last week's are left out. */
export function draftsThisWeek(drafts: Draft[]): Draft[] {
  const monday = thisMonday();
  const next = monday + 7 * DAY_MS;
  return drafts
    .filter((d) => {
      const due = dueAt(d);
      return due === null || (due >= monday && due < next);
    })
    .sort((a, b) => weekOrder(a, monday) - weekOrder(b, monday));
}

/**
 * Drafts due before this Monday that were never decided (planned, drafting or waiting): they are not this week's, but
 * the founder still has to approve or skip them, so they are listed apart instead of hidden.
 */
export function draftsLeftOver(drafts: Draft[]): Draft[] {
  const monday = thisMonday();
  return drafts
    .filter((d) => {
      const due = dueAt(d);
      return due !== null && due < monday && (d.column === "waiting" || d.column === "planned" || d.column === "drafting");
    })
    .sort((a, b) => (dueAt(a) ?? 0) - (dueAt(b) ?? 0));
}

/** "Thu" for a day this week; "Thu 5 Nov" for one before it, so last week's Thursday does not read as this one's. */
export function dayLabel(d: Draft): string | null {
  if (!d.day || dayStart(d.day) >= thisMonday()) return d.dayText;
  return new Date(dayStart(d.day)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
