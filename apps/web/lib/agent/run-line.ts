/**
 * A CMO run the chat started has finished: the line the chat shows, and where column 3 goes
 * (docs/plans/cmo/2026-11-02-cmo-chat-live-plan.md). Pure module: the chat panel (client), the session view and the
 * turn context (server) and the check all import it. The line is fixed text per run kind; nothing a model or a
 * stranger wrote gets into it, and showing it never starts a model turn.
 */

import type { PanelOpen } from "./panel";

export type RunRow = { id: string; kind: string; status: string; error?: string | null };
export type RunLine = { run_id: string; kind: string; status: "done" | "failed"; text: string; open: PanelOpen | null };

const FINISHED = new Set(["done", "failed"]);

/** What finished, and the screen that shows it. Kinds the chat cannot start fall back to a plain "Task". */
const KINDS: Record<string, { done: string; noun: string; open: PanelOpen | null }> = {
  post_draft: { done: "Draft ready to review", noun: "The draft", open: { screen: "writer" } },
  write_caption: { done: "Caption ready to review", noun: "The caption", open: { screen: "writer" } },
  write_video_brief: { done: "Video brief ready", noun: "The video brief", open: { screen: "schedule" } },
  plan_week: { done: "Your week is planned", noun: "The week plan", open: { screen: "dashboard" } },
  sales_scan: { done: "Sales scan finished. New threads are in Sales", noun: "The Sales scan", open: { screen: "sales" } },
  competitor_research: { done: "Research finished", noun: "The research", open: { screen: "research" } },
  niche_video_research: { done: "Video research finished", noun: "The video research", open: { screen: "research" } },
};

export function isFinished(status: string): status is "done" | "failed" {
  return FINISHED.has(status);
}

/** Null while the run is still queued or running. */
export function runLine(run: RunRow): RunLine | null {
  if (!isFinished(run.status)) return null;
  const known = KINDS[run.kind];
  const ids = { ids: [run.id] };
  if (run.status === "done") {
    return { run_id: run.id, kind: run.kind, status: "done", text: known?.done ?? "Task finished", open: known?.open ? { ...known.open, ...ids } : null };
  }
  // The reason stays in the run (get_run_result reads it); the line stays short.
  return { run_id: run.id, kind: run.kind, status: "failed", text: `${known?.noun ?? "The task"} did not finish. Ask me why, or to try again`, open: null };
}

/** Run ids a turn's `create_task` results started (the `view.open` ids it carried). */
export function startedRunIds(results: { name: string; ok: boolean; view?: { open?: { ids?: unknown } } | null }[]): string[] {
  return results.flatMap((result) => {
    const ids = result.name === "create_task" && result.ok ? result.view?.open?.ids : undefined;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  });
}
