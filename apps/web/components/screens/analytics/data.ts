/**
 * Analytics data (S4). Typed here until Session A's `lib/screens/analytics.ts` lands. Every
 * metric is `number | null`: null means the platform did not report it, drawn as a dash, never 0.
 */

export type Platform = "x" | "tiktok" | "linkedin" | "threads" | "youtube" | "instagram";

export type AnalyticsAccount = {
  id: string;
  platform: Platform;
  label: string;
  /** "synced 2 min ago", or null when the account stopped sending data. */
  synced: string | null;
  /** Date the data stopped (shown in the banner and the table), when disconnected. */
  stoppedOn: string | null;
};

export type DayPoint = {
  /** ISO date. */
  date: string;
  /** Impressions per platform; null = that platform sent nothing that day (missing, not zero). */
  values: Partial<Record<Platform, number | null>>;
};

export type AccountRow = {
  accountId: string;
  followers: number | null;
  change: number | null;
  posts: number;
  medianImpressions: number | null;
  engagementRate: number | null;
  worksBest: string;
};

export type PostRow = {
  id: string;
  title: string;
  where: string;
  impressions: number | null;
  engagementRate: number | null;
  /** Impressions divided by the account's own median. */
  vsMedian: number | null;
  read: string;
  href: string | null;
};

export type BrainTakeaway = { title: string; detail: string };

export type AnalyticsScreenData = {
  accounts: AnalyticsAccount[];
  days: DayPoint[];
  totals: {
    impressions: number | null;
    impressionsDelta: number | null;
    engagements: number | null;
    engagementsDelta: number | null;
    engagementRate: number | null;
    engagementRateDeltaPts: number | null;
    followersGained: number | null;
    videoViews: number | null;
    videoViewsDelta: number | null;
    postsMeasured: number;
    postsWithoutData: number;
  };
  byAccount: AccountRow[];
  posts: PostRow[];
  takeaways: BrainTakeaway[];
};

const ACCOUNTS: AnalyticsAccount[] = [
  { id: "x", platform: "x", label: "X · @opencmo", synced: "synced 2 min ago", stoppedOn: null },
  { id: "tt", platform: "tiktok", label: "TikTok · @opencmo", synced: "synced 2 min ago", stoppedOn: null },
  { id: "li", platform: "linkedin", label: "LinkedIn · Marcus", synced: "synced 1 h ago", stoppedOn: null },
  { id: "th", platform: "threads", label: "Threads · @opencmo", synced: null, stoppedOn: "27 Oct" },
  { id: "yt", platform: "youtube", label: "YouTube Shorts · OpenCMO", synced: "synced 3 h ago", stoppedOn: null },
];

/** The frame's seeded wave, so the sample looks the same on every render (no Math.random). */
function sampleDays(count: number): DayPoint[] {
  const today = Date.UTC(2026, 9, 29);
  return Array.from({ length: count }, (_, k) => {
    const i = count - 1 - k;
    const w = Math.sin(i * 1.7) * 0.5 + 0.5;
    const v = Math.cos(i * 0.9) * 0.5 + 0.5;
    const missing = i > 0 && i < 3;
    return {
      date: new Date(today - i * 86_400_000).toISOString().slice(0, 10),
      values: {
        x: Math.round(900 + w * 1600),
        tiktok: Math.round(i % 4 === 0 ? 2600 + v * 4200 : 300 + v * 600),
        linkedin: Math.round(150 + w * 400),
        threads: missing ? null : 0,
      },
    };
  });
}

export const ANALYTICS_SAMPLE: AnalyticsScreenData = {
  accounts: ACCOUNTS,
  days: sampleDays(90),
  totals: {
    impressions: 114_400,
    impressionsDelta: 0.18,
    engagements: 5032,
    engagementsDelta: 0.09,
    engagementRate: 0.044,
    engagementRateDeltaPts: -0.3,
    followersGained: 334,
    videoViews: 51_500,
    videoViewsDelta: 0.31,
    postsMeasured: 26,
    postsWithoutData: 4,
  },
  byAccount: [
    { accountId: "x", followers: 2410, change: 148, posts: 12, medianImpressions: 1920, engagementRate: 0.039, worksBest: "Demo clip, morning" },
    { accountId: "tt", followers: 880, change: 121, posts: 5, medianImpressions: 3400, engagementRate: 0.061, worksBest: "Short under 25 s, 18:00" },
    { accountId: "li", followers: 1105, change: 43, posts: 3, medianImpressions: 640, engagementRate: 0.052, worksBest: "Not enough posts yet" },
    { accountId: "th", followers: 530, change: null, posts: 4, medianImpressions: null, engagementRate: null, worksBest: "" },
    { accountId: "yt", followers: 96, change: 22, posts: 2, medianImpressions: 1150, engagementRate: 0.04, worksBest: "Not enough posts yet" },
  ],
  posts: [
    { id: "p1", title: "Short · “Cut by words”", where: "TikTok", impressions: 9820, engagementRate: 0.074, vsMedian: 2.9, read: "Before/after in the first 2 s", href: null },
    { id: "p2", title: "“Cut by words, a 20 s demo”", where: "X", impressions: 5410, engagementRate: 0.051, vsMedian: 2.8, read: "Demo clip attached", href: null },
    { id: "p3", title: "“Why we built the editor first”", where: "LinkedIn", impressions: 710, engagementRate: 0.06, vsMedian: 1.1, read: "Too few posts to judge", href: null },
    { id: "p4", title: "“Tired of editing demos?”", where: "X", impressions: 1050, engagementRate: 0.022, vsMedian: 0.5, read: "Question opener, text only", href: null },
  ],
  takeaways: [
    { title: "Demo clips beat text on X.", detail: "2.8× your median impressions · 6 posts · feeds Writer and Monday's plan" },
    { title: "Shorts at 18:00 do better than at noon.", detail: "1.9× views · 5 shorts · feeds Schedule's best times" },
    { title: "Question openers underperform.", detail: "0.6× engagement · 4 posts · matches the rule from your edits" },
    { title: "Not enough data on LinkedIn yet.", detail: "3 of 10 posts needed before it changes anything" },
  ],
};
