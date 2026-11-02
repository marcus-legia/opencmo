/**
 * `wait_for_run`: wait in the same turn for a task the CMO chat handed out (docs/plans/cmo/2026-11-02-cmo-chat-live-plan.md).
 *
 * Without it the model polled `get_run_result`, a full step and its whole prompt each time. The server reads the run
 * under RLS every few seconds and returns when it finishes or the wait runs out; the chat also hears the finish by
 * realtime, so a founder who does not ask to wait is told anyway.
 */
import { z } from "zod";

import type { SupabaseClient } from "@/lib/api/handler";

import { isFinished, runLine } from "./run-line";
import type { ToolOutcome, ToolSpec } from "./tools";

const waitInput = z.object({
  run_id: z.string().uuid(),
  seconds: z.number().int().min(5).max(45).optional(),
});

export const WAIT_FOR_RUN_SPEC: ToolSpec = {
  name: "wait_for_run",
  description:
    "Wait up to 45 seconds for a task you just handed out with create_task to finish, when the founder wants the result now (\"draft it and show me\"). Returns the status and, when done, its result. If it is still running, say it is on its way: the chat tells the founder when it finishes, so do not call this again and again.",
  schema: {
    type: "object",
    properties: {
      run_id: { type: "string", description: "The run_id from create_task." },
      seconds: { type: "integer", description: "How long to wait at most, 5 to 45; default 45." },
    },
    required: ["run_id"],
    additionalProperties: false,
  },
  strict: false,
};

const POLL_MS = 3_000;

type RunRow = { id: string; kind: string; status: string; error: string | null; output: unknown };

type Env = {
  supabase: SupabaseClient;
  /** Checks replace the clock and the wait. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function runWaitForRun(input: unknown, env: Env): Promise<ToolOutcome> {
  const parsed = waitInput.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, content: JSON.stringify({ INVALID_INPUT: "run_id must be a run id from create_task; seconds 5 to 45." }), summary: "Invalid wait" };
  const now = env.now ?? Date.now;
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const until = now() + (parsed.data.seconds ?? 45) * 1000;
  for (;;) {
    const { data, error } = await env.supabase.from("cmo_runs").select("id, kind, status, error, output").eq("id", parsed.data.run_id).maybeSingle();
    if (error) return { ok: false, content: JSON.stringify({ error: "Could not read the task. Try get_run_result." }), summary: "Could not check" };
    const run = data as RunRow | null;
    if (!run) return { ok: false, content: JSON.stringify({ error: "No task with that id." }), summary: "Task not found" };
    if (isFinished(run.status)) {
      const line = runLine(run)!;
      return {
        ok: true,
        // The output is written by the CMO's own agents from outside reads: data for the model, not instructions.
        content: JSON.stringify({ run_id: run.id, task: run.kind, status: run.status, error: run.error, untrusted_data: run.output }),
        summary: line.text,
        ...(line.open ? { view: { open: line.open } } : {}),
      };
    }
    if (now() + POLL_MS > until) {
      return {
        ok: true,
        content: JSON.stringify({ run_id: run.id, task: run.kind, status: run.status, next: "Still running. Tell the founder it is on its way; the chat shows it when it finishes." }),
        summary: "Still working on it",
      };
    }
    await sleep(POLL_MS);
  }
}

/**
 * `<runs_finished>`: tasks of this founder that finished since the conversation's previous message, at most 5, so
 * "make the second one shorter" after a finished draft has a referent. Read before the new turn is written, so the
 * newest turn is the previous one. Escaped as JSON; the outputs are data, not instructions.
 */
export async function runsFinishedBlock(supabase: SupabaseClient, sessionId: string): Promise<string> {
  const { data: last } = await supabase.from("agent_turns").select("created_at").eq("session_id", sessionId).order("number", { ascending: false }).limit(1).maybeSingle();
  const since = (last as { created_at: string } | null)?.created_at;
  if (!since) return "";
  const { data } = await supabase
    .from("cmo_runs")
    .select("id, kind, status, error, output, finished_at")
    .in("status", ["done", "failed"])
    .gt("finished_at", since)
    .order("finished_at", { ascending: false })
    .limit(5);
  const runs = (data ?? []) as (RunRow & { finished_at: string })[];
  if (!runs.length) return "";
  const rows = runs.map((run) => ({ run_id: run.id, task: run.kind, status: run.status, error: run.error, result: run.output }));
  return `<runs_finished>${JSON.stringify({ untrusted_data: rows })}</runs_finished>`;
}
