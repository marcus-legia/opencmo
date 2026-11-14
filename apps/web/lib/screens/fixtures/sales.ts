import type { SalesScreen } from "../sales";
import { at } from "./shared";

export const salesFixture: SalesScreen = {
  mentions: { used: 0, window: 10 },
  stuck: { text: "Your last two scans found no conversation worth joining. Try a different brief, or fewer excluded subreddits.", creditsToFinish: 5, found: 0 },
  threads: [
    {
      id: "t-1",
      score: 78,
      platform: "reddit",
      community: "r/SaaS",
      postedAt: at("2026-10-29", "04:42"),
      comments: 41,
      title: "What do you use to edit product demos?",
      url: "https://www.reddit.com/r/SaaS/comments/sample/what_do_you_use_to_edit_product_demos/",
      rule: { kind: "mention_allowed", text: "Mention allowed" },
      parts: [
        { label: "Pain", score: 22, max: 25 },
        { label: "Fit", score: 20, max: 25 },
        { label: "Timing", score: 18, max: 20 },
        { label: "Reach", score: 9, max: 15 },
      ],
      quotes: [
        { text: "I spend more time cutting my demo than building the feature.", from: "original post" },
        { text: "Timeline editors are overkill for a 40 second clip.", from: "top comment" },
      ],
      draft:
        "Same problem here. What helped me: record once, then cut by deleting words from the transcript instead of scrubbing a timeline. Ums and retakes go in a minute. For a 40 second demo, add captions and one zoom on the click that matters, nothing else. I built a tool for this (OpenCMO), but the transcript approach works in most editors now.",
      draftChecks: "No links · product named once, at the end · r/SaaS allows it",
      status: "open",
      approvalId: "card-reply",
    },
    { id: "t-2", platform: "reddit", score: 71, community: "r/indiehackers", postedAt: at("2026-10-28", "10:00"), comments: 18, title: "Solo founders: how do you make launch videos?", url: "https://www.reddit.com/r/indiehackers/comments/sample2/", rule: { kind: "help_only", text: "Help only: no self-promotion rule" }, parts: [], quotes: [], draft: null, draftChecks: null, status: "open", approvalId: null },
    { id: "t-3", platform: "reddit", score: 66, community: "r/startups", postedAt: at("2026-10-27", "10:00"), comments: 9, title: "Descript alternative for short demos?", url: "https://www.reddit.com/r/startups/comments/sample3/", rule: { kind: "mention_allowed", text: "Mention allowed" }, parts: [], quotes: [], draft: null, draftChecks: null, status: "open", approvalId: null },
    { id: "t-5", platform: "facebook", score: 69, community: "SaaS Founders Network", postedAt: at("2026-10-28", "15:20"), comments: 23, title: "How are you all making demo videos without a video person?", url: "https://www.facebook.com/groups/saasfounders/posts/1234567890/", rule: { kind: "help_only", text: "Facebook group: rules not read, help only" }, parts: [], quotes: [], draft: null, draftChecks: null, status: "open", approvalId: null },
    { id: "t-6", platform: "threads", score: 64, community: "Threads", postedAt: at("2026-10-28", "08:05"), comments: 7, title: "Recording product demos is eating my whole week", url: "https://www.threads.com/@samplefounder/post/C9sample123", rule: { kind: "help_only", text: "Threads: help only, no product mention" }, parts: [], quotes: [], draft: null, draftChecks: null, status: "open", approvalId: null },
    { id: "t-4", platform: "reddit", score: 61, community: "r/marketing", postedAt: at("2026-10-26", "10:00"), comments: null, title: "Do AI captions hurt reach?", url: "https://www.reddit.com/r/marketing/comments/sample4/", rule: { kind: "skipped", text: "Skipped: subreddit bans tool mentions" }, parts: [], quotes: [], draft: null, draftChecks: null, status: "open", approvalId: null },
  ],
  week: { replied: 1, dismissed: 3 },
  settings: { excludedSubreddits: ["memes"], pairs: [["video", "editor"]], platforms: ["reddit", "hn", "facebook", "threads"] },
};

export const salesEmpty: SalesScreen = { mentions: { used: 0, window: 10 }, stuck: null, threads: [], week: { replied: 0, dismissed: 0 }, settings: { excludedSubreddits: [], pairs: [], platforms: ["reddit", "hn", "facebook", "threads"] } };
