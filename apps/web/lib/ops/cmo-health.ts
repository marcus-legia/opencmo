/**
 * What `/api/health/cmo` answers (wave 4 B2, `docs/plans/cmo/2026-11-20-wave4-plan.md` §4a.5): one line per Sales
 * source for the owner's uptime check during launch week.
 *
 * - `reader`: whether a key is set that serves the source's reads (Hacker News needs none). Never which provider, never
 *   the key.
 * - `platforms`: when a finished scan last read the source and when it last did not answer. A source whose last two
 *   scans both failed is `failing`; one bad scan is a blip, and `failing` is what pages.
 * - `last_scan`: when the newest Sales scan finished and whether it finished or failed.
 * - `queue`: CMO runs waiting now (a run held for later by `not_before` is not waiting) and the oldest one's age.
 *
 * Nothing in it names a founder, a run, a query or an error text: only times and counts. Pure core (`cmoHealth`) so
 * `uptime.check.ts` runs it on sample rows; the probe reads with the service role, because runs are the founders' own
 * rows and RLS hides them from the anon key.
 */
import { SALES_PLATFORMS, type SalesPlatform } from "@/lib/cmo/social/conversations";
import { scFakeAllowed, socialRoute } from "@/lib/cmo/social/scrapecreators";
import { createAdminClient } from "@/lib/supabase/admin";

/** Paths each source's scan reads: the reader is "ok" only when every one has a provider with a key. */
const READS: Record<SalesPlatform, string[]> = {
  reddit: ["/v1/reddit/search", "/v1/reddit/post/comments"],
  hn: [],
  threads: ["/v1/google/search", "/v1/threads/post"],
  facebook: ["/v1/google/search", "/v1/facebook/post"],
};

/**
 * A CMO run waiting past this long is stuck. `sweep()` dispatches queued runs every minute and a scan takes a few
 * minutes, so a burst of founders clears well inside it; fifteen minutes is no longer a burst.
 */
export const CMO_QUEUE_STUCK_AFTER_SECONDS = 900;
/** How many recent scans the per-source times are read from: a few days of launch-week traffic. */
export const SCANS_READ = 60;

export type ReaderState = "ok" | "missing";
export type SourceState = "ok" | "failing" | "unknown";

export type CmoHealth = {
  ok: boolean;
  reader: Record<SalesPlatform, ReaderState>;
  platforms: Record<SalesPlatform, { state: SourceState; last_success: string | null; last_failure: string | null }>;
  last_scan: { finished_at: string; status: "done" | "failed" } | null;
  queue: { state: "ok" | "stuck" | "unknown"; depth: number | null; oldest_queued_seconds: number | null };
};

/** One finished Sales scan as the probe reads it; `platforms` and `failed` come from its output (absent on a failed run). */
export type ScanRow = { status: "done" | "failed"; finished_at: string | null; platforms: unknown; failed: unknown };
/** The waiting runs: how many, and the oldest one's `created_at` as epoch ms (null when none). */
export type QueueRead = { depth: number; oldest: number | null };

export type CmoHealthProbe = {
  scans: () => Promise<ScanRow[] | undefined>;
  queue: () => Promise<QueueRead | undefined>;
};

const platformsOf = (v: unknown): SalesPlatform[] => (Array.isArray(v) ? SALES_PLATFORMS.filter((p) => v.includes(p)) : []);

/** Whether every read of a source has a provider with a key (or the fake, off in production). */
export function readerStates(route: typeof socialRoute = socialRoute, fake = scFakeAllowed()): Record<SalesPlatform, ReaderState> {
  const out = {} as Record<SalesPlatform, ReaderState>;
  for (const p of SALES_PLATFORMS) out[p] = fake || READS[p].every((path) => route(path, {}) !== null) ? "ok" : "missing";
  return out;
}

export function cmoHealth(reader: Record<SalesPlatform, ReaderState>, scans: ScanRow[] | undefined, queue: QueueRead | undefined, now: number): CmoHealth {
  // Newest first; a row with no time cannot be placed and is left out.
  const rows = (scans ?? [])
    .filter((r): r is ScanRow & { finished_at: string } => typeof r.finished_at === "string" && !Number.isNaN(Date.parse(r.finished_at)))
    .sort((a, b) => Date.parse(b.finished_at) - Date.parse(a.finished_at));
  const platforms = {} as CmoHealth["platforms"];
  for (const p of SALES_PLATFORMS) {
    // A finished scan that looked here: read when it is not in `failed`. A failed run names no source, so it counts
    // against none (it reaches the owner through the failure alert instead).
    const tries = rows.filter((r) => r.status === "done" && platformsOf(r.platforms).includes(p)).map((r) => ({ at: r.finished_at, ok: !platformsOf(r.failed).includes(p) }));
    const iso = (t: { at: string } | undefined) => (t ? new Date(t.at).toISOString() : null);
    const state: SourceState = scans === undefined || !tries.length ? "unknown" : tries.length >= 2 && !tries[0]!.ok && !tries[1]!.ok ? "failing" : "ok";
    platforms[p] = { state, last_success: iso(tries.find((t) => t.ok)), last_failure: iso(tries.find((t) => !t.ok)) };
  }
  const newest = rows[0];
  const age = queue && queue.oldest !== null && Number.isFinite(queue.oldest) ? Math.max(0, Math.round((now - queue.oldest) / 1000)) : null;
  const queueState = queue === undefined ? "unknown" : age !== null && age > CMO_QUEUE_STUCK_AFTER_SECONDS ? "stuck" : "ok";
  // A source with no key, one failing scan after scan, or a stuck queue pages the owner. "unknown" does not (local, CI,
  // no scan yet), as on `/api/health`.
  const ok = SALES_PLATFORMS.every((p) => reader[p] === "ok" && platforms[p].state !== "failing") && queueState !== "stuck";
  return {
    ok,
    reader,
    platforms,
    last_scan: newest ? { finished_at: new Date(newest.finished_at).toISOString(), status: newest.status } : null,
    queue: { state: queueState, depth: queue?.depth ?? null, oldest_queued_seconds: age },
  };
}

const DB_TIMEOUT_MS = 3_000;

function admin() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createAdminClient(AbortSignal.timeout(DB_TIMEOUT_MS));
}

/** The newest finished Sales scans, only the fields above: no user, no input, no error text. */
export const probeScans: CmoHealthProbe["scans"] = async () => {
  const db = admin();
  if (!db) return undefined;
  try {
    const { data, error } = await db
      .from("cmo_runs")
      .select("status, finished_at, platforms:output->platforms, failed:output->failed")
      .eq("kind", "sales_scan")
      .in("status", ["done", "failed"])
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(SCANS_READ);
    if (error) {
      console.error("[health/cmo] scans", error.message);
      return undefined;
    }
    return (data ?? []) as unknown as ScanRow[];
  } catch (error) {
    console.error("[health/cmo] scans", error instanceof Error ? error.message : error);
    return undefined;
  }
};

/** Runs waiting now, on `cmo_runs_queue_idx`; a run held by `not_before` is not waiting yet. */
export const probeCmoQueue: CmoHealthProbe["queue"] = async () => {
  const db = admin();
  if (!db) return undefined;
  const due = `not_before.is.null,not_before.lte.${new Date().toISOString()}`;
  try {
    const [count, oldest] = await Promise.all([
      db.from("cmo_runs").select("id", { count: "exact", head: true }).eq("status", "queued").or(due),
      db.from("cmo_runs").select("created_at").eq("status", "queued").or(due).order("created_at", { ascending: true }).limit(1),
    ]);
    if (count.error || oldest.error) {
      console.error("[health/cmo] queue", (count.error ?? oldest.error)!.message);
      return undefined;
    }
    const at = (oldest.data as { created_at: string }[] | null)?.[0]?.created_at;
    return { depth: count.count ?? 0, oldest: at ? Date.parse(at) : null };
  } catch (error) {
    console.error("[health/cmo] queue", error instanceof Error ? error.message : error);
    return undefined;
  }
};

export async function cmoHealthReport(probe: CmoHealthProbe = { scans: probeScans, queue: probeCmoQueue }, now: number = Date.now()): Promise<CmoHealth> {
  const [scans, queue] = await Promise.all([probe.scans(), probe.queue()]);
  return cmoHealth(readerStates(), scans, queue, now);
}
