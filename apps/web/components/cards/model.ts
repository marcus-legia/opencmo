/**
 * What an approval card shows (Cards.dc.html; docs/architecture/approval.md §5).
 *
 * Presentational props until Session A's `ApprovalCard` contract lands in `lib/screens/` (U0); the screens loader
 * then maps that contract onto this shape. See "Requests" in docs/plans/cmo/2026-10-27-cmo-build-sessions.md.
 */

import type { DepartmentName } from "@/components/shell-v2/nav";

export type CardKind =
  | "post"
  | "reply"
  | "goal"
  | "script"
  | "price"
  | "finished_video"
  | "shorts_batch"
  | "slideshow"
  | "schedule"
  | "correction";

export type CardDepartment = "brain" | DepartmentName;

/** `waiting` is decidable; the others are the four states every card has. */
export type CardState = "waiting" | "expired" | "decided" | "needs_credits" | "failed";

/** The row today's RPCs decide (`cmo_decide_post`, `cmo_decide_opportunity`, `cmo_decide_goal`). */
export type CardRef = { kind: "content_item" | "opportunity" | "goal"; id: string };

export type Platform = "x" | "threads" | "linkedin" | "tiktok" | "instagram" | "youtube";

export type CardBody =
  | { kind: "post"; versions: { platform: Platform; texts: string[] }[]; checks: string[]; why: string | null }
  | {
      kind: "reply";
      community: string;
      threadTitle: string;
      threadUrl: string;
      quote: string | null;
      score: number;
      parts: { label: string; score: number; max: number }[];
      draft: string;
      rules: string;
    }
  | { kind: "goal"; goal: string; plan: { what: string; department: CardDepartment }[]; target: string | null }
  | { kind: "script"; beats: { say: string; picture: string }[] }
  | { kind: "price"; shots: number; lengthSeconds: number; readyMinutes: number }
  | { kind: "finished_video"; lengthSeconds: number; posterUrl: string | null; editorHref: string | null }
  | { kind: "shorts_batch"; shorts: { from: number; to: number; hook: string }[] }
  | { kind: "slideshow"; slides: string[]; outputs: string }
  | { kind: "schedule"; item: string; where: string; when: string; why: string | null }
  | { kind: "correction"; rule: string; edits: { before: string; after: string }[] };

export type ApprovalCardView = {
  id: string;
  kind: CardKind;
  department: CardDepartment;
  /** One line for the collapsed card in the queue. */
  title: string;
  /** Right side of the head: "Thu 09:10", "score 78 / 100", "expires in 3 h". */
  headNote: string | null;
  state: CardState;
  /** Sentence for a non-waiting state: "The slot passed. Pick a new time." */
  stateNote: string | null;
  /** Foot: what it costs, where it goes, when. Null parts are left out. */
  price: number | null;
  account: string | null;
  when: string | null;
  note: string | null;
  ref: CardRef | null;
  /** Fixture card: decisions change this screen only. */
  sample: boolean;
  body: CardBody;
};

export const NUMERAL: Record<CardDepartment, string> = {
  brain: "",
  research: "I",
  writer: "II",
  studio: "III",
  sales: "IV",
  schedule: "V",
  publish: "VI",
};

export const DEPARTMENT_LABEL: Record<CardDepartment, string> = {
  brain: "Brain",
  research: "Research",
  writer: "Writer",
  studio: "Studio",
  sales: "Sales",
  schedule: "Schedule",
  publish: "Publish",
};

export const KIND_LABEL: Record<CardKind, string> = {
  post: "Post",
  reply: "Reddit reply",
  goal: "Goal + week plan",
  script: "Script",
  price: "Price",
  finished_video: "Finished video",
  shorts_batch: "Shorts",
  slideshow: "Slideshow",
  schedule: "Time",
  correction: "Correction",
};

export const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  threads: "Threads",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

/** "Writer · Post · X": the head every card and queue row starts with. */
export function cardHead(card: ApprovalCardView): string {
  const parts = [DEPARTMENT_LABEL[card.department], KIND_LABEL[card.kind]];
  if (card.body.kind === "post" && card.body.versions[0]) parts.push(PLATFORM_LABEL[card.body.versions[0].platform]);
  return parts.join(" · ");
}

/** The log line written when the founder approves a card. */
export function approvedLine(card: ApprovalCardView): string {
  switch (card.body.kind) {
    case "post":
      return `You approved the ${PLATFORM_LABEL[card.body.versions[0]?.platform ?? "x"]} post`;
    case "reply":
      return `You replied in ${card.body.community}`;
    case "goal":
      return "You approved the week";
    case "script":
      return "You approved the script";
    case "price":
      return "You approved the video price";
    case "finished_video":
      return "You marked the video finished";
    case "shorts_batch":
      return `You approved ${card.body.shorts.length} shorts`;
    case "slideshow":
      return "You approved the slideshow";
    case "schedule":
      return `You approved ${card.body.when}`;
    case "correction":
      return "You kept a new rule";
  }
}

export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
