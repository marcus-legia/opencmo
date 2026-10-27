/**
 * What the Dashboard shows (Main.dc.html, DashboardPhone.dc.html).
 *
 * Presentational props until Session A's `DashboardScreen` contract lands in `lib/screens/` (U0); the screens loader
 * then fills this shape. `live` says which blocks read real rows; the others show the "Sample data" tag.
 */

import type { ApprovalCardView } from "@/components/cards/model";
import type { DepartmentName } from "@/components/shell-v2/nav";

export type NodeState = "working" | "idle" | "stuck";

export type TeamNode = { department: DepartmentName; state: NodeState; status: string };

export type LogEvent = { id: string; at: string; who: "brain" | "you" | DepartmentName; text: string };

export type ResultRow = {
  account: string;
  impressions: string | null;
  /** Last 7 days, oldest first. */
  series: number[];
  tone: "ink" | "brand" | "flat";
  trend: string;
  followers: number | null;
  best: string | null;
  /** Set when the account stopped reporting. */
  broken: { note: string; href: string } | null;
};

export type OutgoingRow = {
  id: string;
  /** Local time "HH:MM" in the founder's time zone. */
  time: string;
  where: string;
  what: string;
  status: "failed" | "posted" | "scheduled" | "waiting";
  note: string | null;
  fixHref: string | null;
  /** The schedule card that decides this row, while it waits. */
  cardId: string | null;
};

export type DashboardView = {
  timezone: string;
  week: {
    goal: string | null;
    done: number;
    total: number;
    wordsToday: number | null;
    credits: { used: number; budget: number | null };
  };
  brain: { status: string; line: string; nextCheck: string | null };
  team: TeamNode[];
  log: LogEvent[];
  results: { rows: ResultRow[]; lesson: string | null };
  today: OutgoingRow[];
  queue: ApprovalCardView[];
  /** The next card the founder can expect, for the empty queue. */
  nextCard: string | null;
  paused: boolean;
  live: { queue: boolean; team: boolean; log: boolean; week: boolean; results: boolean; today: boolean; pause: boolean };
};

export const TEAM_ORDER: DepartmentName[] = ["research", "writer", "studio", "sales", "schedule", "publish"];
