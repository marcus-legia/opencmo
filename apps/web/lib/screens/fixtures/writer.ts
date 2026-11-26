import type { WriterScreen } from "../writer";
import { at } from "./shared";

export const writerFixture: WriterScreen = {
  drafts: ([
    { id: "d-1", kind: "post", platform: "linkedin", at: null, dayText: "Fri", title: "Lesson from week 1 of the CMO running on itself", column: "drafting", versions: 1, note: null, approvalId: null },
    { id: "d-2", kind: "post", platform: "linkedin", at: null, dayText: "Sat", title: "Approving 10 cards a day from a phone", column: "drafting", versions: 1, note: null, approvalId: null },
    { id: "d-3", kind: "post", platform: "x", at: at("2026-10-29", "09:10"), dayText: null, title: "Most AI video tools stop at the first draft. We built the editor first…", column: "waiting", versions: 3, note: null, approvalId: "card-post" },
    { id: "d-4", kind: "post", platform: "linkedin", at: at("2026-10-29", "14:30"), dayText: null, title: "What a week of approving cards taught me", column: "scheduled", versions: 1, note: null, approvalId: null, slotId: "slot-d4" },
    { id: "d-5", kind: "post", platform: "x", at: at("2026-10-30", "09:10"), dayText: null, title: "Thread: building an editor as a marketing team of one", column: "scheduled", versions: 1, note: null, approvalId: null, slotId: "slot-d5" },
    { id: "d-6", kind: "post", platform: "x", at: at("2026-10-26", "09:00"), dayText: null, title: "Editor launch teaser", column: "posted", versions: 1, note: "You edited 2 lines · results tomorrow", approvalId: null },
    { id: "d-7", kind: "post", platform: "linkedin", at: at("2026-10-26", "16:00"), dayText: null, title: "Why we built the editor first", column: "posted", versions: 1, note: "Approved as drafted", approvalId: null },
    { id: "d-8", kind: "post", platform: "x", at: at("2026-10-27", "09:10"), dayText: null, title: "Cut by words, a 20 s demo", column: "posted", versions: 1, note: null, approvalId: null },
    { id: "d-9", kind: "caption", platform: "tiktok", at: at("2026-10-29", "18:00"), dayText: null, title: "Short 1 · Edit by asking", column: "waiting", versions: 2, note: null, approvalId: "card-time" },
  ] as WriterScreen["drafts"]).map((d, i, all) => (d.kind === "post" ? { ...d, no: all.length - i } : d)),
  timezone: "Europe/London",
  voice: {
    lines: [
      { text: "Short sentences, one idea each.", source: "From 6 edits · last Tue" },
      { text: "Don't open with a question.", source: "Rule you approved · Sun" },
      { text: "“We” on X, “I” on LinkedIn.", source: "From 4 edits" },
      { text: "No links, no hashtags in posts.", source: "Product rule · hashtags only on videos" },
    ],
    wordsCut: ["game-changer", "unlock", "seamless", "leverage"],
  },
};

export const writerEmpty: WriterScreen = { drafts: [], timezone: "UTC", voice: { lines: [], wordsCut: [] } };
