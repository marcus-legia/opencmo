/**
 * What `/api/health` answers (hardening backlog step 3, docs/plans/engineering/2026-11-15-uptime-plan.md).
 *
 * An uptime monitor calls it every minute from outside, so it is public, cheap and says nothing an attacker could use:
 * which part is down, never why. The database check reads one row of the public price list with the anon key, the same
 * read the landing page makes, so it needs no secret and proves PostgREST, the gateway and Postgres answer.
 */
import { createClient } from "@supabase/supabase-js";

export type Health = { ok: boolean; checks: { web: "ok"; database: "ok" | "down" } };

const DB_TIMEOUT_MS = 3_000;

export type DatabaseProbe = () => Promise<boolean>;

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

export async function healthReport(probe: DatabaseProbe = probeDatabase): Promise<Health> {
  const database = (await probe()) ? "ok" : "down";
  return { ok: database === "ok", checks: { web: "ok", database } };
}
