/**
 * What `/api/health` answers (hardening backlog step 3, docs/plans/engineering/2026-11-15-uptime-plan.md).
 *
 * An uptime monitor calls it every minute from outside, so it is public, cheap and says nothing an attacker could use:
 * which part is down, never why. The database check reads one row of the public price list with the anon key, the same
 * read the landing page makes, so it needs no secret and proves PostgREST, the gateway and Postgres answer.
 *
 * The queue check (round 2, item 3) reads the oldest queued job. The Modal `sweep` can be alive and checking in while
 * nothing leaves the queue (a crash loop in `run_job`, the container quota), and only this sees it.
 */
import { createClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export type QueueState = "ok" | "stuck" | "unknown";

export type Health = {
  ok: boolean;
  checks: { web: "ok"; database: "ok" | "down"; queue: QueueState };
  /** Seconds the oldest queued job has waited; null when the queue is empty or could not be read. */
  oldest_queued_seconds: number | null;
};

const DB_TIMEOUT_MS = 3_000;

/**
 * A queued job is stuck past ten minutes. The web app spawns `run_job` at submit, and `sweep()` (every minute,
 * `packages/engine/modal_app.py`) claims up to SWEEP_BATCH = 10 more, so a healthy queue empties within a minute or
 * two even in a burst. A job whose 120 s lease ran out goes back to the queue with its first `created_at` but is
 * claimed by the same sweep that requeued it (reconcile runs before claims). Ten minutes is ten sweeps without a
 * claim: no longer a burst.
 */
export const QUEUE_STUCK_AFTER_SECONDS = 600;

export type DatabaseProbe = () => Promise<boolean>;
/** The oldest queued job's `created_at` as epoch ms; null for an empty queue; undefined when it could not be read. */
export type QueueProbe = () => Promise<number | null | undefined>;

/** True when the database answers a one-row read in time. */
export const probeDatabase: DatabaseProbe = async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;
  try {
    const { error } = await createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      .from("billing_catalog")
      .select("slug")
      .limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) console.error("[health] database", error.message);
    return !error;
  } catch (error) {
    console.error("[health] database", error instanceof Error ? error.message : error);
    return false;
  }
};

/**
 * One read on `jobs_queue_idx` (`created_at where status = 'queued'`). Jobs are not readable with the anon key, so this
 * is the service role, reading one timestamp and nothing a request can steer. Tasks are left out on purpose: they wait
 * queued by design while RUN_TASK_MAX_CONTAINERS are running, so their age is noise.
 */
export const probeQueue: QueueProbe = async () => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return undefined;
  try {
    const { data, error } = await createAdminClient(AbortSignal.timeout(DB_TIMEOUT_MS))
      .from("jobs")
      .select("created_at")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) {
      console.error("[health] queue", error.message);
      return undefined;
    }
    const at = data?.[0]?.created_at;
    return at ? Date.parse(at) : null;
  } catch (error) {
    console.error("[health] queue", error instanceof Error ? error.message : error);
    return undefined;
  }
};

export async function healthReport(
  probe: DatabaseProbe = probeDatabase,
  queueProbe: QueueProbe = probeQueue,
  now: number = Date.now(),
): Promise<Health> {
  const [databaseUp, oldest] = await Promise.all([probe(), queueProbe()]);
  const database = databaseUp ? "ok" : "down";
  const age = typeof oldest === "number" && Number.isFinite(oldest) ? Math.max(0, Math.round((now - oldest) / 1000)) : null;
  const queue: QueueState = oldest === undefined ? "unknown" : age !== null && age > QUEUE_STUCK_AFTER_SECONDS ? "stuck" : "ok";
  // A stuck queue fails the check: the uptime monitor is what pages the owner, and uploads that never start are an
  // outage for the founder even while every page loads. "unknown" does not (local, CI, a key not set).
  return { ok: database === "ok" && queue !== "stuck", checks: { web: "ok", database, queue }, oldest_queued_seconds: age };
}
