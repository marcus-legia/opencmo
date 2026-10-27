/**
 * One sample card of each kind, from `Cards.dc.html`, plus the state examples. The Dashboard fixture's queue
 * is the first five of `Main.dc.html`; the rest are here for the card sheet and `/app/inbox/[id]`.
 */

import type { ApprovalCard } from "../approval-card";
import { at } from "./shared";

const base = {
  status: "waiting",
  priceCredits: null,
  postAt: null,
  account: null,
  raisedAt: at("2026-10-29", "07:00"),
  expiresAt: null,
  decidedAt: null,
  decidedVia: null,
  problem: null,
} as const;

export const POST_CARD: ApprovalCard = {
  ...base,
  id: "card-post",
  kind: "post",
  department: "writer",
  title: "Most AI video tools stop at the first draft.",
  summary: "We built the editor first: cut by words, then ask for the B-roll on the line you mean.",
  meta: "Checks passed · no links · Thu 09:10 · @opencmo",
  postAt: at("2026-10-29", "09:10"),
  account: { platform: "x", handle: "@opencmo" },
  body: {
    kind: "post",
    platforms: [
      {
        platform: "x",
        versions: [
          "Most AI video tools stop at the first draft. We built the editor first: cut by words, then ask for the B-roll on the line you mean.",
          "The first draft is where most AI video tools stop. Ours starts there: cut by words, then ask for B-roll on the line you mean.",
          "We built the editor before anything else. Cut by deleting words, then ask for B-roll on the exact line.",
        ],
        limit: 280,
      },
      { platform: "threads", versions: ["Most AI video tools stop at the first draft. We built the editor first."], limit: 500 },
      { platform: "linkedin", versions: ["Most AI video tools stop at the first draft. Here is why we built the editor first."], limit: 3000 },
    ],
    checks: ["no links", "checker ok"],
    why: "Tuesday's insight, editor-first launches",
  },
};

export const PRICE_CARD: ApprovalCard = {
  ...base,
  id: "card-price",
  kind: "price",
  department: "studio",
  title: "Long video “How the CMO plans a week” · 60 s",
  summary: "12 shots between keyframes you approved. Ready in about 25 minutes.",
  meta: "Credits held until the video is done",
  priceCredits: 24,
  expiresAt: at("2026-10-29", "11:42"),
  body: { kind: "price", what: "Long video “How the CMO plans a week”", shots: 12, seconds: 60, readyInMinutes: 25 },
};

export const SHORTS_CARD: ApprovalCard = {
  ...base,
  id: "card-shorts",
  kind: "shorts_batch",
  department: "studio",
  title: "3 shorts from “Editor launch”",
  summary: "Hooks: cut by words · B-roll on the line · edit by asking. Captions and hashtags written.",
  meta: "Cut from a finished edit · no generation credits",
  body: {
    kind: "shorts_batch",
    source: "Editor launch",
    shorts: [
      { start: 0, end: 22, hook: "Cut by words", previewUrl: null },
      { start: 18, end: 41, hook: "B-roll on the line", previewUrl: null },
      { start: 38, end: 60, hook: "Edit by asking", previewUrl: null },
    ],
  },
};

export const REPLY_CARD: ApprovalCard = {
  ...base,
  id: "card-reply",
  kind: "reply",
  department: "sales",
  title: "r/SaaS · “What do you use to edit product demos?”",
  summary: "“I spend more time cutting my demo than building the feature.” Reply drafted, help first.",
  meta: "Score 78 · product mention allowed · you post it yourself",
  account: { platform: "reddit", handle: "you" },
  body: {
    kind: "reply",
    community: "r/SaaS",
    threadTitle: "What do you use to edit product demos?",
    threadUrl: "https://www.reddit.com/r/SaaS/comments/sample/what_do_you_use_to_edit_product_demos/",
    score: 78,
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
      "I had the same problem. What helped: record once, then cut by deleting words from the transcript instead of scrubbing the timeline. Ums and retakes go in a minute.",
    rules: "product mention allowed · you post it yourself",
  },
};

export const SCHEDULE_CARD: ApprovalCard = {
  ...base,
  id: "card-time",
  kind: "schedule",
  department: "schedule",
  title: "Short 1 to TikTok @opencmo, today 18:00",
  summary: "Your time zone: Asia/Ho_Chi_Minh. Changing the time or account asks you again.",
  meta: "Why 18:00: your last shorts did best after work",
  postAt: at("2026-10-29", "18:00"),
  account: { platform: "tiktok", handle: "@opencmo" },
  expiresAt: at("2026-10-29", "18:00"),
  body: {
    kind: "schedule",
    what: "Short 1 “Edit by asking”",
    where: { platform: "tiktok", handle: "@opencmo" },
    at: at("2026-10-29", "18:00"),
    why: "your last 4 shorts did best after work",
  },
};

export const GOAL_CARD: ApprovalCard = {
  ...base,
  id: "card-goal",
  kind: "goal",
  department: "brain",
  title: "Launch the editor",
  summary: "5 posts, 1 long video + 3 shorts, 1 slideshow, 2 Reddit replies.",
  meta: "Target: 2 sign-ups from posts",
  priceCredits: 80,
  body: {
    kind: "goal",
    goalId: "goal-sample",
    week: "2026-10-26",
    goal: "Launch the editor",
    metric: "posts",
    target: 5,
    plan: [
      { what: "5 posts · X, Threads, LinkedIn", department: "writer" },
      { what: "1 long video + 3 shorts", department: "studio" },
      { what: "1 slideshow", department: "studio" },
      { what: "2 Reddit replies", department: "sales" },
    ],
    budgetCredits: 80,
  },
};

export const SCRIPT_CARD: ApprovalCard = {
  ...base,
  id: "card-script",
  kind: "script",
  department: "studio",
  title: "Script for “How the CMO plans a week” · 6 beats",
  summary: "Approve the words and pictures; keyframes are priced next.",
  meta: "Nothing spent yet",
  body: {
    kind: "script",
    beats: [
      { words: "You recorded the demo.", picture: "Desk, laptop, morning light." },
      { words: "Now cut it by words.", picture: "Transcript lines fade out." },
      { words: "Ask for B-roll.", picture: "Slash command, shot drops in." },
    ],
    nextPriceCredits: 6,
  },
};

export const FINISHED_CARD: ApprovalCard = {
  ...base,
  id: "card-finished",
  kind: "finished_video",
  department: "studio",
  title: "“Editor launch” is rendered · 1:00",
  summary: "Approving marks it finished: Shorts can be cut from it.",
  meta: "Open in the editor to tweak first",
  body: { kind: "finished_video", clipId: "clip-sample", seconds: 60, previewUrl: null },
};

export const SLIDESHOW_CARD: ApprovalCard = {
  ...base,
  id: "card-slideshow",
  kind: "slideshow",
  department: "studio",
  title: "3 ways to cut a demo · 6 slides",
  summary: "MP4 and a PNG set, ready for Threads and LinkedIn.",
  meta: "MP4 + PNG",
  body: { kind: "slideshow", slides: ["3 ways to cut a demo", "1. Cut by words", "2. Ask for B-roll"], formats: ["mp4", "png"] },
};

export const CORRECTION_CARD: ApprovalCard = {
  ...base,
  id: "card-correction",
  kind: "correction",
  department: "brain",
  title: "“Don't open posts with a question.”",
  summary: "Learned from 3 of your edits this week.",
  meta: "Keep it and every draft follows it",
  body: {
    kind: "correction",
    correctionId: "correction-sample",
    rule: "Don't open posts with a question.",
    examples: [
      { before: "Tired of editing demos?", after: "Editing a demo shouldn't take longer than building it." },
      { before: "What if you could cut by words?", after: "Cut a video by deleting words." },
    ],
  },
};

/** The four states every card has, on copies of real kinds. */
export const STATE_CARDS: ApprovalCard[] = [
  { ...SCHEDULE_CARD, id: "card-expired", status: "expired", problem: { kind: "expired", text: "The slot passed. Pick a new time." } },
  {
    ...POST_CARD,
    id: "card-decided",
    status: "approved",
    decidedAt: at("2026-10-29", "08:42"),
    decidedVia: "push",
    problem: { kind: "decided_elsewhere", text: "You approved this on your phone at 08:42." },
  },
  { ...PRICE_CARD, id: "card-credits", problem: { kind: "needs_credits", text: "Needs 24 credits; you have 12. Top up or cancel." } },
  { ...POST_CARD, id: "card-failed", problem: { kind: "failed", text: "Threads rejected the post: reconnect the account." } },
];

/** Every kind once, in `Cards.dc.html` order. */
export const ALL_KINDS: ApprovalCard[] = [
  POST_CARD,
  REPLY_CARD,
  GOAL_CARD,
  SCRIPT_CARD,
  PRICE_CARD,
  FINISHED_CARD,
  SHORTS_CARD,
  SLIDESHOW_CARD,
  SCHEDULE_CARD,
  CORRECTION_CARD,
];
