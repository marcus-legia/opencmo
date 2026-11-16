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
import { healthReport, QUEUE_STUCK_AFTER_SECONDS } from "./health";
import { readSentryDsn } from "./sentry-dsn";

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

  console.log("uptime.check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
