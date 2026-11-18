import type { SettingsScreen } from "../settings";
import { ACCOUNTS, TZ } from "./shared";

/** `Settings.dc.html`. */
export const settingsFixture: SettingsScreen = {
  accounts: ACCOUNTS.filter((a) => a.platform !== "youtube"),
  cmo: { pausedAt: null },
  weeklyCreditBudget: 80,
  timezone: TZ,
  digestHour: 7,
  digestDays: "weekdays",
  emailLog: [
    { id: "log-2", kind: "digest", day: "2026-11-19", status: "sent", subject: "3 people are asking on r/SaaS and Hacker News", summary: { people: 3, followUps: 1, posts: 2 }, at: "2026-11-19T01:00:00.000Z" },
    { id: "log-1", kind: "digest", day: "2026-11-18", status: "skipped", subject: null, summary: { people: 0, followUps: 0, posts: 0, note: "Nothing new: no person, follow-up or post due" }, at: "2026-11-18T01:00:00.000Z" },
  ],
  plan: { name: "Starter", credits: 312 },
  autopilot: { platforms: ["x"], hours: 12, note: null, paused: false },
};

export const settingsEmpty: SettingsScreen = {
  accounts: [],
  cmo: { pausedAt: null },
  weeklyCreditBudget: 0,
  timezone: "UTC",
  digestHour: null,
  digestDays: "weekdays",
  emailLog: [],
  plan: { name: "Free", credits: null },
  autopilot: { platforms: [], hours: 12, note: null, paused: false },
};
