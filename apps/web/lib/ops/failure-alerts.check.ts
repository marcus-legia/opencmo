/**
 * The hourly alert on founder failures (lib/ops/failure-alerts.ts). No Sentry, no database.
 *
 *   cd apps/web && npx tsx lib/ops/failure-alerts.check.ts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { alertEvents, FAILURES_MONITOR, sendAlerts, type AlertSink } from "./failure-alerts";
import { warningLabel, type FailureGroup } from "./failures";

const FOUNDER = "e3220000-0000-4000-8000-00000000000a";
const ROW = "e3221000-0000-4000-8000-00000000000a";

const group = (over: Partial<FailureGroup> = {}): FailureGroup => ({
  source: "jobs",
  kind: "clip",
  key: "Probe of <id>.mp4 failed after <n> s.",
  failures: 3,
  accounts: 2,
  first_seen: "2026-11-17T10:00:00Z",
  last_seen: "2026-11-17T10:40:00Z",
  stuck: false,
  latest: [{ id: ROW, user_id: FOUNDER, at: "2026-11-17T10:40:00Z", error: "Probe of founder-secret-name.mp4 failed after 12 s.", stuck: false }],
  ...over,
});

async function main() {
  const events = alertEvents({
    groups: [group(), group({ source: "cmo_runs", kind: "onboard", key: "Stuck: still running past its lease or time limit.", stuck: true })],
    warnings: [{ code: "transcript_failed", jobs: 4, accounts: 3, first_seen: "2026-11-17T10:00:00Z", last_seen: "2026-11-17T10:50:00Z", latest: [ROW] }],
  });
  assert.equal(events.length, 3, "one event per group and per warning code");

  const [failure, stuck, warning] = events;
  assert.equal(failure!.level, "error");
  assert.deepEqual(failure!.fingerprint, ["founder-failure", "jobs", "clip", "Probe of <id>.mp4 failed after <n> s."], "one Sentry issue per group");
  assert.equal(failure!.message, "Founder failure: Video project · clip: Probe of ….mp4 failed after N s.");
  assert.equal(failure!.extra.accounts, 2);
  assert.match(stuck!.message, /^Founder work stuck: CMO run · onboard/);
  assert.equal(stuck!.level, "error", "stuck work is an error too");
  assert.equal(warning!.level, "warning");
  assert.deepEqual(warning!.fingerprint, ["founder-failure", "jobs", "warning", "transcript_failed"]);
  assert.equal(warning!.extra.jobs, 4);

  // Nothing that names a founder or a row leaves for Sentry: only the grouped key and counts.
  const out = JSON.stringify(events);
  assert.ok(!out.includes(FOUNDER), "no user id");
  assert.ok(!out.includes(ROW), "no row or job id");
  assert.ok(!out.includes("founder-secret-name"), "no raw error of one row");

  const long = alertEvents({ groups: [group({ key: "x".repeat(5000) })], warnings: [] });
  assert.ok(long[0]!.message.length <= 200, "a long key is cut for the issue title");
  assert.equal(long[0]!.fingerprint[3]!.length, 5000, "the fingerprint keeps the whole key, so two long keys stay two issues");

  assert.deepEqual(alertEvents({ groups: [], warnings: [] }), [], "a quiet hour sends nothing");
  assert.deepEqual(alertEvents({} as never), [], "an answer without sections sends nothing");

  const sent: { message: string; level: string; fingerprint: string[] }[] = [];
  const sink: AlertSink = {
    captureMessage: (message, context) => {
      sent.push({ message, level: context.level, fingerprint: context.fingerprint });
      return "event-id";
    },
  };
  assert.equal(sendAlerts(events, sink), 3);
  assert.deepEqual(sent.map((s) => s.level), ["error", "error", "warning"]);

  // The monitor's schedule is Modal's: the digest function calls the route right after the digest.
  const modal = await readFile(path.join(import.meta.dirname, "../../../../packages/engine/modal_app.py"), "utf8");
  const at = modal.indexOf('"/api/cron/failures"');
  assert.ok(at > 0, "modal_app.py calls /api/cron/failures");
  const crons = [...modal.slice(0, at).matchAll(/modal\.Cron\("([^"]+)"\)/g)];
  assert.equal(crons.at(-1)?.[1], FAILURES_MONITOR.crontab);

  // Every code the worker publishes reads in words on the page.
  const worker = await readFile(path.join(import.meta.dirname, "../../../../packages/engine/opencmo/worker/process_job.py"), "utf8");
  const codes = [...worker.matchAll(/^(?:TRANSCRIPT|FRAMING)_[A-Z_]+ = "([a-z_]+)"$/gm)].map((m) => m[1]!);
  assert.equal(codes.length, 4, "process_job.py declares its warning codes");
  for (const code of codes) assert.notEqual(warningLabel(code), code, `the page explains ${code}`);

  console.log("failure-alerts.check: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
