/**
 * `wait_for_media`: wait until the AI media this clip is generating has finished, in one call.
 *
 * Generation runs on the worker for one to three minutes. Without this the model polled
 * `list_library` again and again, a full step (and its whole prompt) each time. The server reads
 * the clip's `generations` rows under RLS and returns once nothing is queued or running, or after
 * `seconds`; the model then captures the finished shots or calls again.
 */
import { z } from "zod";

import type { SupabaseClient } from "@/lib/api/handler";

import { spec, type ToolOutcome } from "./tools";

const waitInput = z.object({
  seconds: z.number().int().min(5).max(60).optional().describe("How long to wait at most, 5 to 60 seconds; default 45."),
});

export const WAIT_TOOL_SPEC = spec(
  "wait_for_media",
  "Wait until the AI media generating for this clip (shots, images, voice, music) has finished, instead of calling list_library again and again. Returns each piece as done, failed (with the reason; its credits come back) or still generating. Call it after an approved generation when the next step needs the result, then capture frames where the new media plays. If pieces are still generating when it returns, call it again.",
  waitInput,
);

export type GenerationRow = { kind: string; status: string; error: string | null; spec: { prompt?: unknown } | null; created_at: string };

const RUNNING = new Set(["queued", "running"]);
/** Pieces started this long ago or less count as this session's work. */
const RECENT_MS = 60 * 60 * 1000;
const POLL_MS = 3_000;

const label = (row: GenerationRow) => {
  const prompt = typeof row.spec?.prompt === "string" ? row.spec.prompt.replace(/\s+/g, " ").trim() : "";
  return `${row.kind}${prompt ? `: ${prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt}` : ""}`;
};

/** What the model reads back: a count per state and what to do next. */
export function waitReport(rows: GenerationRow[]): { ok: boolean; content: string; summary: string } {
  const running = rows.filter((row) => RUNNING.has(row.status));
  const failed = rows.filter((row) => row.status === "failed");
  const done = rows.filter((row) => row.status === "done");
  if (!rows.length) {
    return { ok: true, content: JSON.stringify({ pieces: [], next: "Nothing is generating for this clip." }), summary: "Nothing generating" };
  }
  const next = running.length
    ? "Some pieces are still generating. Call wait_for_media again, or do other edits meanwhile."
    : failed.length
      ? "Generation finished. The failed pieces were refunded; tell the user, or try once more with a changed prompt if the reason allows."
      : "Everything finished. The editor places each piece a few seconds after it is done: capture frames where the new media plays to check it.";
  return {
    ok: true,
    content: JSON.stringify({
      done: done.length,
      failed: failed.map((row) => ({ piece: label(row), reason: row.error ?? "Generation failed." })),
      still_generating: running.map(label),
      next,
    }),
    summary: running.length ? `${running.length} still generating` : failed.length ? `${done.length} done, ${failed.length} failed` : `${done.length} done`,
  };
}

type Env = {
  supabase: SupabaseClient;
  clipId: string;
  /** Tests replace the clock and the wait. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function runWaitForMedia(input: unknown, env: Env): Promise<ToolOutcome> {
  const parsed = waitInput.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, content: JSON.stringify({ INVALID_INPUT: parsed.error.issues[0]?.message ?? "Invalid input." }), summary: "Invalid wait" };
  const now = env.now ?? Date.now;
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const until = now() + (parsed.data.seconds ?? 45) * 1000;
  const since = new Date(now() - RECENT_MS).toISOString();
  for (;;) {
    const { data, error } = await env.supabase
      .from("generations")
      .select("kind, status, error, spec, created_at")
      .eq("clip_id", env.clipId)
      .gte("created_at", since)
      .order("created_at", { ascending: true });
    if (error) return { ok: false, content: JSON.stringify({ error: "Could not read the generations. Try list_library." }), summary: "Could not check" };
    const rows = (data ?? []) as GenerationRow[];
    if (!rows.some((row) => RUNNING.has(row.status)) || now() + POLL_MS > until) return waitReport(rows);
    await sleep(POLL_MS);
  }
}
