/**
 * `/api/health` and the cron monitors (docs/plans/engineering/2026-11-15-uptime-plan.md). No network.
 *
 *   cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/ops/uptime.check.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { config as middleware } from "../../middleware";
import { CRON_MONITORS, withCronMonitor } from "./cron-monitor";
import { CMO_QUEUE_STUCK_AFTER_SECONDS, cmoHealth, readerStates, type ScanRow } from "./cmo-health";
import { healthReport, QUEUE_STUCK_AFTER_SECONDS } from "./health";
import { assertSentryDsn, readSentryDsn } from "./sentry-dsn";

async function main() {
  // Health: which part is down, never why.
  const now = Date.parse("2026-11-16T12:00:00Z");
  const empty = async () => null;
  assert.deepEqual(await healthReport(async () => true, empty, now), {
    ok: true,
    checks: { web: "ok", database: "ok", queue: "ok" },
    oldest_queued_seconds: null,
  });
  assert.deepEqual(await healthReport(async () => false, empty, now), {
    ok: false,
    checks: { web: "ok", database: "down", queue: "ok" },
    oldest_queued_seconds: null,
  });

  // The queue: a job waiting past the threshold fails the check; one inside it, or a queue we cannot read, does not.
  const waiting = (seconds: number) => async () => now - seconds * 1000;
  const fresh = await healthReport(async () => true, waiting(90), now);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.checks.queue, "ok");
  assert.equal(fresh.oldest_queued_seconds, 90);
  assert.equal((await healthReport(async () => true, waiting(QUEUE_STUCK_AFTER_SECONDS), now)).ok, true, "at the threshold is not stuck yet");
  const stuck = await healthReport(async () => true, waiting(QUEUE_STUCK_AFTER_SECONDS + 1), now);
  assert.equal(stuck.ok, false, "a stuck queue pages the owner through the uptime monitor");
  assert.equal(stuck.checks.queue, "stuck");
  const unread = await healthReport(async () => true, async () => undefined, now);
  assert.equal(unread.ok, true, "local and CI have no service key: unknown, not down");
  assert.equal(unread.checks.queue, "unknown");
  assert.equal(unread.oldest_queued_seconds, null);
  assert.equal((await healthReport(async () => true, waiting(-5), now)).oldest_queued_seconds, 0, "clock skew never reads negative");

  // Sentry's DSN: the cut-off value production had on 2026-11-16 must read as invalid, not as "on".
  const key = "0123456789abcdef0123456789abcdef"; // gitleaks:allow (made-up DSN key)
  assert.equal(readSentryDsn(undefined).state, "off");
  assert.equal(readSentryDsn("  ").state, "off");
  assert.equal(readSentryDsn(`https://${key}@o1.ingest.us.sentry.io/42`).state, "ok");
  assert.equal(readSentryDsn(` https://${key}@o1.ingest.us.sentry.io/42\n`).state, "ok", "whitespace from a paste is trimmed");
  assert.equal(readSentryDsn(`https://${key}@sentry.example.com/sub/path/42`).state, "ok", "self-hosted path prefix");
  assert.equal(readSentryDsn(`http://${key}@localhost:9000/1`).state, "ok", "a single-label host");
  assert.equal(readSentryDsn(`https://${key}@o1.ingest.us.`).state, "invalid", "the truncation found in production");
  assert.equal(readSentryDsn(`https://${key}@o1.ingest.us.sentry.io/`).state, "invalid", "no project id");
  assert.equal(readSentryDsn("https://o1.ingest.us.sentry.io/42").state, "invalid", "no public key");
  assert.equal(readSentryDsn(`${key}@o1.ingest.us.sentry.io/42`).state, "invalid", "no scheme");
  // The build gate (round 3): unset and valid pass; a cut-off value throws, and the message never carries the value.
  assert.doesNotThrow(() => assertSentryDsn(undefined));
  assert.doesNotThrow(() => assertSentryDsn(`https://${key}@o1.ingest.us.sentry.io/42`));
  assert.throws(
    () => assertSentryDsn(`https://${key}@o1.ingest.us.`),
    (e: Error) => e.message.includes("NEXT_PUBLIC_SENTRY_DSN") && !e.message.includes(key),
  );

  // The route itself, with no database configured: 503, never cached.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const { GET } = await import("../../app/api/health/route");
  const down = await GET();
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("cache-control"), "no-store");
  assert.deepEqual(await down.json(), {
    ok: false,
    checks: { web: "ok", database: "down", queue: "unknown" },
    oldest_queued_seconds: null,
  });


  // /api/health/cmo (wave 4 B2): one line per Sales source, the newest scan, the CMO queue. Times and counts only.
  {
    const allOk = { reddit: "ok", hn: "ok", threads: "ok", facebook: "ok" } as const;
    const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    const scans: ScanRow[] = [
      { status: "done", finished_at: at(10), platforms: ["reddit", "hn", "threads"], failed: ["threads"] },
      { status: "failed", finished_at: at(20), platforms: null, failed: null },
      { status: "done", finished_at: at(30), platforms: ["reddit", "threads"], failed: ["threads"] },
      { status: "done", finished_at: at(40), platforms: ["reddit", "facebook"], failed: ["reddit"] },
      { status: "done", finished_at: null, platforms: ["facebook"], failed: ["facebook"] },
    ];
    const h = cmoHealth(allOk, scans, { depth: 2, oldest: now - 60_000 }, now);
    assert.deepEqual(h.platforms.reddit, { state: "ok", last_success: at(10), last_failure: at(40) }, "one failure long ago is not failing");
    assert.deepEqual(h.platforms.threads, { state: "failing", last_success: null, last_failure: at(10) }, "two failed reads in a row");
    assert.equal(h.platforms.hn.state, "ok");
    assert.deepEqual(h.platforms.facebook, { state: "ok", last_success: at(40), last_failure: null }, "a row with no time is left out");
    assert.deepEqual(h.last_scan, { finished_at: at(10), status: "done" });
    assert.deepEqual(h.queue, { state: "ok", depth: 2, oldest_queued_seconds: 60 });
    assert.equal(h.ok, false, "a failing source pages the owner");
    assert.equal(JSON.stringify(h).includes("user"), false, "no founder in the answer");

    const quiet = cmoHealth(allOk, [], { depth: 0, oldest: null }, now);
    assert.equal(quiet.ok, true, "no scan yet is unknown, not down");
    assert.equal(quiet.platforms.reddit.state, "unknown");
    assert.equal(quiet.last_scan, null);
    const unread = cmoHealth(allOk, undefined, undefined, now);
    assert.equal(unread.ok, true, "local and CI have no service key");
    assert.equal(unread.queue.state, "unknown");
    const stuck = cmoHealth(allOk, [], { depth: 5, oldest: now - (CMO_QUEUE_STUCK_AFTER_SECONDS + 1) * 1000 }, now);
    assert.equal(stuck.queue.state, "stuck");
    assert.equal(stuck.ok, false);
    assert.equal(cmoHealth({ ...allOk, facebook: "missing" }, [], { depth: 0, oldest: null }, now).ok, false, "a source with no reader pages");

    // The reader: Hacker News needs no key; Facebook and Threads need Google search too, which Lurk does not serve.
    const only = (paths: string[]) => (path: string) => (paths.includes(path) ? { provider: "lurk" as const, url: "", key: "" } : null);
    assert.deepEqual(readerStates(only([]), false), { reddit: "missing", hn: "ok", threads: "missing", facebook: "missing" });
    assert.deepEqual(readerStates(only(["/v1/reddit/search", "/v1/reddit/post/comments", "/v1/threads/post"]), false), { reddit: "ok", hn: "ok", threads: "missing", facebook: "missing" });
    assert.deepEqual(readerStates(only([]), true), allOk, "the fake reads everything (never in production)");
  }

  // The middleware skips /api/health (a ping a minute needs no session check), and only it.
  const matcher = new RegExp(`^${middleware.matcher[0]}$`);
  assert.equal(matcher.test("/api/health"), false, "/api/health skips the middleware");
  assert.equal(matcher.test("/api/healthz"), true);
  assert.equal(matcher.test("/api/v1/projects"), true);
  assert.equal(matcher.test("/app"), true);

  // Cron monitors: the status code decides the final check-in.
  const calls: { status: string; slug: string; schedule?: string }[] = [];
  const fake = {
    captureCheckIn: ((checkIn: { status: string; monitorSlug: string }, config?: { schedule?: { value?: string } }) => {
      calls.push({ status: checkIn.status, slug: checkIn.monitorSlug, schedule: config?.schedule?.value });
      return "id-1";
    }) as never,
    flush: (async () => true) as never,
  };
  const run = async (status: number) => {
    calls.length = 0;
    await withCronMonitor(CRON_MONITORS.cmo, async () => new Response(null, { status }), fake);
    return calls.map((c) => c.status);
  };
  assert.deepEqual(await run(200), ["in_progress", "ok"]);
  assert.deepEqual(await run(500), ["in_progress", "error"], "a 5xx answer is a failed run");
  assert.equal(calls[0]!.slug, "cron-cmo");
  assert.equal(calls[0]!.schedule, "5 * * * *");
  calls.length = 0;
  await assert.rejects(withCronMonitor(CRON_MONITORS.cleanup, async () => { throw new Error("boom"); }, fake));
  assert.deepEqual(calls.map((c) => c.status), ["in_progress", "error"]);

  // The monitors' schedules are Modal's: a monitor on the wrong schedule cries wolf, or misses a dead clock.
  const modal = await readFile(path.join(import.meta.dirname, "../../../../packages/engine/modal_app.py"), "utf8");
  const scheduleOf = (route: string) => {
    const at = modal.indexOf(`"${route}"`);
    assert.ok(at > 0, `modal_app.py calls ${route}`);
    const crons = [...modal.slice(0, at).matchAll(/modal\.Cron\("([^"]+)"\)/g)];
    return crons.at(-1)?.[1];
  };
  assert.equal(scheduleOf("/api/cron/cmo"), CRON_MONITORS.cmo.crontab);
  assert.equal(scheduleOf("/api/cron/cmo-digest"), CRON_MONITORS.digest.crontab);
  assert.equal(scheduleOf("/api/cron/cleanup"), CRON_MONITORS.cleanup.crontab);
  assert.equal(scheduleOf("/api/cron/x-news"), CRON_MONITORS.xNews.crontab);

  console.log("uptime.check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
