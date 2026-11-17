# Session B — ops and secrets

Plan: [`../2026-11-16-web-hardening-round-2-plan.md`](../2026-11-16-web-hardening-round-2-plan.md). Waits on nothing.
Do not run `npm run dev`, a build or the engine's full pytest while session A runs e2e; ask A first.

Goal: the monitoring shipped in round 1 actually reports, the job queue's heartbeat is watched, and no secret sits in
the repo's history.

## Todo, in order

- [x] 1. **Why Sentry has no cron monitor.** Read-only: `apps/web/lib/ops/cron-monitor.ts`, the cron routes under
  `apps/web/app/api/cron/**`, the Sentry init files, and Sentry itself (`find_monitors`, `search_issues` for
  `cron-cmo`; reading is fine, changing is not). Likely causes: the check-in is queued but the function ends before
  it is sent (needs `await Sentry.flush()`), the DSN is not set at runtime on the server, or round 1 is not deployed.
  Fix what is code; write what is config under "For the owner". Add a `.check.ts` for whatever you fix.
- [x] 2. **Watch the Modal `sweep`.** It runs every queued job each minute (`packages/engine/modal_app.py`). Simplest
  shape first: one Sentry cron check-in from the sweep (Python `sentry_sdk.crons`), monitor slug `modal-sweep`,
  `* * * * *`, a margin of a few minutes. No new dependency if `sentry_sdk` is already in the engine; if it is not,
  stop and ask the owner. Without a DSN it must be a no-op. pytest for the no-DSN path.
- [x] 3. **Stuck-job signal.** If the sweep is alive but jobs still wait (a crash loop, the container quota), nothing
  says so. Add to `/api/health` (or its ops helper) the age of the oldest queued job, and report it as degraded past a
  threshold you justify from `modal_app.py`'s lease and sweep timings. Keep `/api/health` cheap: one indexed query.
- [x] 4. **Secrets.** Run `gitleaks` once over the whole history (`gitleaks git --redact`, binary downloaded to the
  scratchpad, not the repo). Report findings to the owner in chat with the file, commit and kind, never the value.
  Then add `.github/workflows/secrets.yml` running gitleaks on each PR's diff, and a `.gitleaks.toml` allowlisting the
  local Supabase CLI demo keys (see `lighthouse.yml`'s comment) and test fixtures, nothing broader.
- [x] 5. Update the backlog's §3 and §5 state columns for what round 1 and this session made true.
- [x] 6. `/code-review` and the `security-review-checklist` skill on your diff, fix, commit (`git add` your paths
  only), `git pull --rebase`, push. (Done in the whole-branch review, `4d7fac5`.)

## What B found and changed (2026-11-16)

1. **Cause: production's `NEXT_PUBLIC_SENTRY_DSN` is cut off** after `…ingest.us.` (no `sentry.io/<project id>`; read
   from the public bundle on opencmo.io and compared with the project's client key). Sentry's SDK drops a DSN it cannot
   parse without a word, so nothing reached Sentry from production: no error since the two manual test events of
   2026-11-08, no cron check-in, no monitor. Round 1 is deployed (release `ce43cb2`) and `withCronMonitor` already
   flushes; the code was not the cause. Fixed in code: `lib/ops/sentry-dsn.ts` reads the DSN like Sentry does; a bad
   one logs `sentry_dsn_invalid` at server boot and a console error in the browser, and Live switches has a Sentry row.
   Checked in `lib/ops/uptime.check.ts` (the truncated shape) and `lib/ops/switches.check.ts`.
2. **Sweep heartbeat** without a new dependency: the engine has no `sentry_sdk`, so `opencmo/worker/cron_monitor.py`
   posts to Sentry's HTTP check-in endpoint with `httpx` (already a dependency). `sweep()` sends `ok` or `error` from a
   `finally`; slug `modal-sweep`, `* * * * *`, margin 3 min, an issue after 3 misses. No-op without `SENTRY_DSN`.
   `tests/test_worker_cron_monitor.py`. Not sent to the real Sentry (that would create the monitor).
3. **`/api/health`** adds `checks.queue` and `oldest_queued_seconds` (one read on `jobs_queue_idx`, service role,
   since jobs are not readable with the anon key). Past 10 minutes the queue is `stuck` and the route answers 503;
   reasoning in `lib/ops/health.ts`. Tasks are left out: they wait queued by design behind `RUN_TASK_MAX_CONTAINERS`.
   `lib/supabase/admin.ts`'s list of allowed callers (and the root CLAUDE.md line) should add `lib/ops/health.ts`;
   neither file is B's, so that is for the whole-branch pass.
4. **gitleaks 8.30.1** over all 1,732 commits: 137 findings, none a live secret (details reported to the owner in
   chat). `.github/workflows/secrets.yml` scans each PR's commits with a checksum-pinned binary; `.gitleaks.toml`
   allows the Supabase CLI demo JWTs (`iss: supabase-demo`) and the two vendor API docs (`docs/creem-llm.txt`,
   `docs/zernio.txt`). A fixture gets a `gitleaks:allow` comment on its line instead of an allowlist entry.

Review notes left for the whole-branch pass (files B does not own): `lib/supabase/admin.ts` and the root CLAUDE.md
should list `lib/ops/health.ts` as a service-role caller; `next.config.ts` could fail the build when
`NEXT_PUBLIC_SENTRY_DSN` is set but invalid (`readSentryDsn`), which stops a bad DSN at deploy instead of logging it.
Kept on purpose: `oldest_queued_seconds` stays in the public health answer (the checklist asks for the age; it says
how long the queue waits, nothing about whose work).

## Checks before each push

`npm run typecheck`, `cd apps/web && npm run check:contracts`; engine: `.venv312/bin/python -m pytest -q <your tests>`
and `ruff check .`.

## For the owner (write here, do not do)

- **Vercel: fix `NEXT_PUBLIC_SENTRY_DSN`** (Production, and Preview if set). Copy the DSN again from Sentry → Project
  settings → Client keys; the whole value ends in `.sentry.io/<project id>`. Then **redeploy**: it is inlined at build,
  so changing the variable alone changes nothing. Check: a new deploy's log has no `sentry_dsn_invalid`, and Live
  switches shows Sentry on. Within the hour `cron-cmo-digest` and `cron-cmo` appear under Sentry → Crons.
- **Modal: add `SENTRY_DSN`** (the same DSN) to the secret `opencmo`, then redeploy the worker (`modal deploy`) and stop
  the running container so the secret is read. Check: `modal-sweep` appears under Sentry → Crons within a few minutes.
- Sentry: the uptime monitor on `/api/health` and one alert rule (from the uptime plan), once item 1 shows check-ins.
  `/api/health` now also answers 503 when a job has waited more than 10 minutes, so the uptime monitor covers a stuck
  queue too.
- GitHub: turn on secret scanning's non-provider patterns (Settings → Code security).
- Any secret item 4 finds: rotate it at the provider first, then decide whether to rewrite history.
