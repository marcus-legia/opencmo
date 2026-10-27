/**
 * Fixture content from Main.dc.html and Cards.dc.html, shown only behind NEXT_PUBLIC_OPENCMO_UI=v2 and only while the
 * screens route has no Dashboard (Session A, U0). It moves to `lib/screens/fixtures/` when that lands; numbers are not
 * product data.
 */

import type { ApprovalCardView } from "@/components/cards/model";

import type { DashboardView } from "./model";

const card = (c: Omit<ApprovalCardView, "state" | "stateNote" | "ref" | "sample" | "price" | "account" | "when" | "note"> & Partial<ApprovalCardView>): ApprovalCardView => ({
  state: "waiting",
  stateNote: null,
  ref: null,
  sample: true,
  price: null,
  account: null,
  when: null,
  note: null,
  ...c,
});

export const SAMPLE_CARDS: ApprovalCardView[] = [
  card({
    id: "sample-post",
    kind: "post",
    department: "writer",
    title: "Most AI video tools stop at the first draft.",
    headNote: "Thu 09:10",
    account: "@opencmo",
    when: "Thu 09:10",
    body: {
      kind: "post",
      versions: [
        {
          platform: "x",
          texts: [
            "Most AI video tools stop at the first draft. We built the editor first: cut by words, then ask for the B-roll on the line you mean.",
            "The first draft is where most AI video tools stop. Ours starts there: cut by words, then ask for B-roll on the exact line.",
            "Cut a video by deleting words. Ask for B-roll on the line you mean. That is the whole editor.",
          ],
        },
        { platform: "threads", texts: ["Most AI video tools stop at the first draft. We built the editor first: cut by words, then B-roll on the line you mean."] },
        { platform: "linkedin", texts: ["Most AI video tools stop at the first draft. We built the editor first, so you cut by words and ask for B-roll on the line you mean."] },
      ],
      checks: ["212/280", "no links", "checker ok"],
      why: "Tuesday's insight, editor-first launches",
    },
  }),
  card({
    id: "sample-price",
    kind: "price",
    department: "studio",
    title: "Long video “How the CMO plans a week” · 60 s",
    headNote: "12 shots",
    price: 48,
    note: "held until the video is done",
    body: { kind: "price", shots: 12, lengthSeconds: 60, readyMinutes: 25 },
  }),
  card({
    id: "sample-shorts",
    kind: "shorts_batch",
    department: "studio",
    title: "3 shorts from “Editor launch”",
    headNote: "3 × 9:16",
    note: "Cut from a finished edit · no generation credits",
    body: {
      kind: "shorts_batch",
      shorts: [
        { from: 0, to: 22, hook: "Cut by words" },
        { from: 18, to: 41, hook: "B-roll on the line" },
        { from: 38, to: 60, hook: "Edit by asking" },
      ],
    },
  }),
  card({
    id: "sample-reply",
    kind: "reply",
    department: "sales",
    title: "r/SaaS · “What do you use to edit product demos?”",
    headNote: "score 78 / 100",
    body: {
      kind: "reply",
      community: "r/SaaS",
      threadTitle: "What do you use to edit product demos?",
      threadUrl: "https://www.reddit.com/r/SaaS/",
      quote: "I spend more time cutting my demo than building the feature.",
      score: 78,
      parts: [
        { label: "Pain", score: 22, max: 25 },
        { label: "Fit", score: 20, max: 25 },
        { label: "Timing", score: 18, max: 20 },
        { label: "Reach", score: 9, max: 15 },
      ],
      draft: "I had the same problem. What helped: record once, then cut by deleting words from the transcript instead of scrubbing the timeline…",
      rules: "product mention allowed · you post it yourself",
    },
  }),
  card({
    id: "sample-time",
    kind: "schedule",
    department: "schedule",
    title: "Short 1 to TikTok @opencmo, today 18:00",
    headNote: "expires in 3 h",
    body: {
      kind: "schedule",
      item: "Short 1 “Edit by asking”",
      where: "TikTok · @opencmo",
      when: "Today 18:00",
      why: "your last 4 shorts did best after work",
    },
  }),
];

/** The kinds the queue sample does not hold, for the component sheet and `/app/inbox/[id]`. */
export const SAMPLE_KIT: ApprovalCardView[] = [
  card({
    id: "sample-goal",
    kind: "goal",
    department: "brain",
    title: "Launch the editor",
    headNote: "Mon",
    price: 80,
    body: {
      kind: "goal",
      goal: "Launch the editor",
      plan: [
        { what: "5 posts · X, Threads, LinkedIn", department: "writer" },
        { what: "1 long video + 3 shorts", department: "studio" },
        { what: "1 slideshow", department: "studio" },
        { what: "2 Reddit replies", department: "sales" },
      ],
      target: "2 sign-ups from posts",
    },
  }),
  card({
    id: "sample-script",
    kind: "script",
    department: "studio",
    title: "Script for “How the CMO plans a week”",
    headNote: "6 beats",
    note: "Keyframes next: 32 credits",
    body: {
      kind: "script",
      beats: [
        { say: "You recorded the demo.", picture: "Desk, laptop, morning light." },
        { say: "Now cut it by words.", picture: "Transcript lines fade out." },
        { say: "Ask for B-roll.", picture: "Slash command, shot drops in." },
      ],
    },
  }),
  card({
    id: "sample-finished",
    kind: "finished_video",
    department: "studio",
    title: "“How the CMO plans a week” is ready",
    headNote: "1:00",
    body: { kind: "finished_video", lengthSeconds: 60, posterUrl: null, editorHref: null },
  }),
  card({
    id: "sample-slideshow",
    kind: "slideshow",
    department: "studio",
    title: "3 ways to cut a demo",
    headNote: "6 slides · MP4 + PNG",
    body: { kind: "slideshow", slides: ["3 ways to cut a demo", "1. Cut by words", "2. Ask for B-roll"], outputs: "MP4 + PNG" },
  }),
  card({
    id: "sample-correction",
    kind: "correction",
    department: "brain",
    title: "Don't open posts with a question.",
    headNote: "from 3 edits",
    body: {
      kind: "correction",
      rule: "Don't open posts with a question.",
      edits: [
        { before: "Tired of editing demos?", after: "Editing a demo shouldn't take longer than building it." },
        { before: "What if you could cut by words?", after: "Cut a video by deleting words." },
      ],
    },
  }),
  card({
    id: "sample-expired",
    kind: "schedule",
    department: "schedule",
    title: "Short 2 to TikTok @opencmo, yesterday 18:00",
    headNote: "expired",
    state: "expired",
    stateNote: "The slot passed. Pick a new time.",
    body: { kind: "schedule", item: "Short 2 “B-roll on the line”", where: "TikTok · @opencmo", when: "Yesterday 18:00", why: null },
  }),
  card({
    id: "sample-decided",
    kind: "post",
    department: "writer",
    title: "Cut a video by deleting words from its transcript.",
    headNote: "Thu 08:00",
    state: "decided",
    stateNote: "You approved this on your phone at 08:42.",
    body: { kind: "post", versions: [{ platform: "threads", texts: ["Cut a video by deleting words from its transcript."] }], checks: [], why: null },
  }),
  card({
    id: "sample-credits",
    kind: "price",
    department: "studio",
    title: "Explainer “Three departments” · 45 s",
    headNote: "9 shots",
    price: 36,
    state: "needs_credits",
    stateNote: "Needs 36; you have 12. Top up or cancel.",
    body: { kind: "price", shots: 9, lengthSeconds: 45, readyMinutes: 20 },
  }),
  card({
    id: "sample-failed",
    kind: "post",
    department: "publish",
    title: "Cut a video by deleting words from its transcript.",
    headNote: "Thu 08:00",
    state: "failed",
    stateNote: "Threads rejected the post: reconnect the account.",
    body: { kind: "post", versions: [{ platform: "threads", texts: ["Cut a video by deleting words from its transcript."] }], checks: [], why: null },
  }),
];

export function sampleDashboard(now = new Date()): DashboardView {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  return {
    timezone: "Asia/Ho_Chi_Minh",
    week: { goal: "Launch the editor", done: 9, total: 14, wordsToday: 1840, credits: { used: 38, budget: 80 } },
    brain: { status: "on track", line: "Watching 14 orders", nextCheck: "18:00" },
    team: [
      { department: "research", state: "idle", status: "Asleep until 18:00 · metrics run" },
      { department: "writer", state: "working", status: "Drafting LinkedIn post · line 3" },
      { department: "studio", state: "working", status: "Rendering shot 9 of 12 · 62%" },
      { department: "sales", state: "stuck", status: "Stuck: scan over budget" },
      { department: "schedule", state: "working", status: "Next slot 14:30" },
      { department: "publish", state: "idle", status: "Posted 1 of 3 today · next 14:30" },
    ],
    log: [
      { id: "l1", at: at(1), who: "writer", text: "Drafted line 3 of the LinkedIn post" },
      { id: "l2", at: at(2), who: "studio", text: "Rendered a shot of the long take" },
      { id: "l3", at: at(4), who: "brain", text: "Checked 14 orders: 1 stuck, 5 wait on you" },
      { id: "l4", at: at(6), who: "writer", text: "Second checker passed version 2" },
      { id: "l5", at: at(9), who: "publish", text: "Confirmed the X post went out at 09:10" },
    ],
    results: {
      rows: [
        { account: "X · @opencmo", impressions: "14.2k", series: [30, 45, 40, 60, 100, 70, 85], tone: "ink", trend: "Rising", followers: 48, best: "Cut by words, a 20 s demo · 2.8×", broken: null },
        { account: "TikTok · @opencmo", impressions: "18.9k", series: [15, 100, 35, 20, 80, 30, 25], tone: "brand", trend: "Spiky, rising", followers: 61, best: "Short “Cut by words” · 2.9×", broken: null },
        { account: "LinkedIn · Marcus", impressions: "2.1k", series: [40, 50, 45, 40, 55, 50, 45], tone: "flat", trend: "Flat", followers: 12, best: null, broken: null },
        { account: "Threads · @opencmo", impressions: null, series: [], tone: "flat", trend: "No data", followers: null, best: null, broken: { note: "No data since 27 Oct: reconnect to resume", href: "/app/settings" } },
      ],
      lesson: "3 lessons for next week. Demo clips on X, shorts at 18:00, no question openers.",
    },
    today: [
      { id: "t1", time: "08:00", where: "Threads · @opencmo", what: "“Cut a video by deleting words from its transcript.”", status: "failed", note: "Failed: reconnect account", fixHref: "/app/settings", cardId: null },
      { id: "t2", time: "09:10", where: "X · @opencmo", what: "“Most AI video tools stop at the first draft.”", status: "posted", note: null, fixHref: null, cardId: null },
      { id: "t3", time: "14:30", where: "LinkedIn · Marcus", what: "“What a week of approving cards taught me.”", status: "scheduled", note: null, fixHref: null, cardId: null },
      { id: "t4", time: "18:00", where: "TikTok · @opencmo", what: "Short 1 · “Edit by asking”", status: "waiting", note: null, fixHref: null, cardId: "sample-time" },
    ],
    queue: SAMPLE_CARDS,
    nextCard: "Next card: Writer drafts Friday's posts at 07:00. The morning email tells you what came in.",
    paused: false,
    live: { queue: false, team: false, log: false, week: false, results: false, today: false, pause: false },
  };
}
