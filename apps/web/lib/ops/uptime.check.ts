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
import { healthReport } from "./health";

async function main() {
  // Health: which part is down, never why.
  assert.deepEqual(await healthReport(async () => true), { ok: true, checks: { web: "ok", database: "ok" } });
  assert.deepEqual(await healthReport(async () => false), { ok: false, checks: { web: "ok", database: "down" } });

  // The route itself, with no database configured: 503, never cached.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const { GET } = await import("../../app/api/health/route");
  const down = await GET();
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("cache-control"), "no-store");
  assert.deepEqual(await down.json(), { ok: false, checks: { web: "ok", database: "down" } });

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
