/**
 * An `approvals` row → the `ApprovalCard` contract. Built from the row's snapshot only: the card shows exactly
 * what the founder approves (the snapshot the hash covers), never a newer version of the source row.
 *
 * Pure (no server-only): `screens.check.ts` runs it on sample rows.
 */

import { FinishedVideoSnapshotSchema, PriceSnapshotSchema, ScriptSnapshotSchema, ShortsBatchSnapshotSchema, type ApprovalCard, type CardKind } from "./approval-card";
import type { Department, ScorePart } from "./common";

/** The columns of `approvals` the app reads (RLS: the founder's own). */
export const APPROVAL_COLUMNS =
  "id, kind, department, ref_kind, ref_id, status, snapshot, content_hash, price_credits, post_at, account, expires_at, created_at, decided_at, decided_via";

export type ApprovalRow = {
  id: string;
  kind: CardKind;
  department: Department;
  ref_kind: "content_item" | "opportunity" | "goal" | "correction" | "studio_step" | "editor_project" | "short_batch";
  ref_id: string;
  status: ApprovalCard["status"];
  snapshot: Record<string, unknown>;
  content_hash: string;
  price_credits: number | null;
  post_at: string | null;
  account: string | null;
  expires_at: string | null;
  created_at: string;
  decided_at: string | null;
  decided_via: ApprovalCard["decidedVia"];
};

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Supabase returns `timestamptz` as `2026-10-29T03:42:00.123+00:00`; the contract wants a valid ISO offset. */
const ts = (v: string | null): string | null => (v ? new Date(v).toISOString() : null);

function firstSentence(text: string): { head: string; rest: string } {
  const m = /^(.+?[.!?])(\s+|$)/.exec(text);
  if (!m || m[1]!.length > 200) return { head: clip(text, 200), rest: "" };
  return { head: m[1]!, rest: text.slice(m[0].length).trim() };
}

type Built = Pick<ApprovalCard, "title" | "summary" | "meta" | "body">;

function build(row: ApprovalRow): Built | null {
  const s = row.snapshot;
  switch (row.kind) {
    case "post": {
      const text = str(s.text);
      const versions = [text, ...strings(s.alternates)].filter(Boolean).slice(0, 3);
      const { head, rest } = firstSentence(text);
      return {
        title: head || clip(str(s.idea), 200),
        summary: clip(rest || str(s.rationale) || text, 400),
        meta: `${versions.length} ${versions.length === 1 ? "version" : "versions"} · X · you post it on your account`,
        body: { kind: "post", platforms: [{ platform: "x", versions: versions.length ? versions : [str(s.idea)], limit: 280 }], checks: [], why: str(s.rationale) || null },
      };
    }
    case "reply": {
      const parts = (Array.isArray(s.score_parts) ? s.score_parts : []) as Partial<ScorePart & { evidence: string }>[];
      const valid = parts.filter((p) => typeof p.label === "string" && typeof p.score === "number" && typeof p.max === "number" && p.max > 0);
      const quotes = valid.filter((p) => typeof p.evidence === "string" && p.evidence).map((p) => ({ text: clip(p.evidence!, 400), from: p.label!.toLowerCase() }));
      const community = str(s.community) || "Reddit";
      const score = typeof s.score === "number" ? Math.round(s.score) : 0;
      return {
        title: clip(`${community} · “${str(s.title)}”`, 300),
        summary: clip(quotes[0] ? `“${quotes[0].text}” Reply drafted, help first.` : "Reply drafted, help first.", 400),
        meta: `Score ${score} · you post it yourself`,
        body: {
          kind: "reply",
          community,
          threadTitle: clip(str(s.title), 300),
          threadUrl: str(s.url),
          score,
          parts: valid.map((p) => ({ label: p.label!, score: p.score!, max: p.max! })),
          quotes,
          draft: str(s.reply),
          rules: "you post it yourself",
        },
      };
    }
    case "goal": {
      const metric = str(s.metric);
      if (metric !== "posts" && metric !== "replies" && metric !== "views") return null;
      const target = typeof s.target === "number" ? s.target : 1;
      return {
        title: clip(str(s.goal), 300),
        summary: `This week's goal: ${target} ${metric}. Approving it lets the plan aim at it.`,
        meta: `Week of ${str(s.week)}`,
        body: { kind: "goal", goalId: row.ref_id, week: str(s.week), goal: clip(str(s.goal), 200), metric, target, plan: [], budgetCredits: null },
      };
    }
    case "correction": {
      const edits = (Array.isArray(s.source_edits) ? s.source_edits : []) as { before?: unknown; after?: unknown }[];
      const examples = edits
        .filter((e) => typeof e.before === "string" && typeof e.after === "string")
        .map((e) => ({ before: clip(e.before as string, 300), after: clip(e.after as string, 300) }));
      return {
        title: clip(`“${str(s.rule)}”`, 300),
        summary: examples.length ? `Learned from ${examples.length} of your edits.` : "Learned from your edits and skip reasons.",
        meta: "Keep it and every draft follows it",
        body: { kind: "correction", correctionId: row.ref_id, rule: str(s.rule), examples },
      };
    }
    // Studio (P2): the snapshot holds paths, never URLs; the screen loader signs them (`signStudioCard`), so a card built
    // here shows no pictures yet. A snapshot that does not parse is not shown rather than shown wrong.
    case "script": {
      const parsed = ScriptSnapshotSchema.safeParse(s);
      if (!parsed.success || parsed.data.beats.length === 0) return null;
      const v = parsed.data;
      return {
        title: clip(`Script for “${v.title}” · ${v.beats.length} ${v.beats.length === 1 ? "beat" : "beats"}`, 300),
        summary: "Approve the words and pictures; the keyframes are made next at the price below.",
        meta: "Nothing spent until you approve",
        body: { kind: "script", stepId: v.step_id, seconds: v.seconds, aspect: v.aspect, beats: v.beats, nextPriceCredits: v.price_credits },
      };
    }
    case "price": {
      const parsed = PriceSnapshotSchema.safeParse(s);
      if (!parsed.success || parsed.data.seconds === null) return null;
      const v = parsed.data;
      const shots = v.shots === 1 ? "1 shot" : `${v.shots} shots`;
      return {
        title: clip(`${v.title} · ${Math.round(v.seconds!)} s`, 300),
        summary: clip(`${v.what || shots}.${v.wait_minutes ? ` Ready in about ${v.wait_minutes} minutes.` : ""}`, 400),
        meta: v.keyframes.length ? "Redo any keyframe before you approve · credits held until the video is done" : "Credits held until the video is done",
        body: {
          kind: "price",
          stepId: v.step_id,
          what: v.what,
          keyframes: v.keyframes.map((k) => ({ index: k.index, label: k.words, thumbUrl: null, garbled: k.garbled, credits: k.credits })),
          shots: v.shots,
          seconds: v.seconds!,
          readyInMinutes: v.wait_minutes,
        },
      };
    }
    case "finished_video": {
      const parsed = FinishedVideoSnapshotSchema.safeParse(s);
      if (!parsed.success || parsed.data.seconds === null) return null;
      const v = parsed.data;
      return {
        title: clip(`“${v.title || "Your video"}” is rendered · ${Math.floor(v.seconds! / 60)}:${String(Math.round(v.seconds!) % 60).padStart(2, "0")}`, 300),
        summary: "Approving marks it finished: shorts can be cut from it.",
        meta: "Open it in the editor to tweak first",
        body: { kind: "finished_video", clipId: v.clip_id, documentHash: v.document_hash, seconds: v.seconds!, previewUrl: null, frameAt: Math.min(2, v.seconds! / 2) },
      };
    }
    case "shorts_batch": {
      const parsed = ShortsBatchSnapshotSchema.safeParse(s);
      if (!parsed.success || parsed.data.shorts.length === 0) return null;
      const v = parsed.data;
      return {
        title: clip(`${v.shorts.length} ${v.shorts.length === 1 ? "short" : "shorts"} from “${v.title || "your video"}”`, 300),
        summary: clip(`Hooks: ${v.shorts.map((x) => x.hook).join(" · ")}.`, 400),
        meta: "Cut from a finished edit · no generation credits",
        body: {
          kind: "shorts_batch",
          batchId: v.batch_id,
          parentClipId: v.parent_clip_id,
          source: v.title,
          shorts: v.shorts.map((x) => ({ shortClipId: x.short_clip_id, start: x.start, end: x.end, hook: x.hook, reason: x.reason, previewUrl: null })),
        },
      };
    }
    default:
      // Slideshow and Schedule cards arrive with their phases; until then a row of those kinds is not shown.
      return null;
  }
}

export function approvalToCard(row: ApprovalRow, now = new Date()): ApprovalCard | null {
  const built = build(row);
  if (!built) return null;
  const expired = row.status === "expired" || (row.status === "waiting" && row.expires_at !== null && new Date(row.expires_at) <= now);
  const elsewhere = row.status !== "waiting" && !expired && row.decided_via !== null && row.decided_via !== "app";
  return {
    id: row.id,
    kind: row.kind,
    department: row.department,
    status: row.status,
    ...built,
    priceCredits: row.price_credits,
    postAt: ts(row.post_at),
    account: null,
    raisedAt: ts(row.created_at)!,
    expiresAt: ts(row.expires_at),
    decidedAt: ts(row.decided_at),
    decidedVia: row.decided_via,
    contentHash: row.content_hash,
    problem: expired
      ? { kind: "expired", text: "This card expired. A new one will ask again." }
      : elsewhere
        ? { kind: "decided_elsewhere", text: row.decided_via === "mcp" ? "You decided this through your Claude." : "You decided this on another device." }
        : null,
  };
}
