# Session B — ops and secrets

Plan: [`../2026-11-16-web-hardening-round-2-plan.md`](../2026-11-16-web-hardening-round-2-plan.md). Waits on nothing.
Do not run `npm run dev`, a build or the engine's full pytest while session A runs e2e; ask A first.

Goal: the monitoring shipped in round 1 actually reports, the job queue's heartbeat is watched, and no secret sits in
the repo's history.

## Todo, in order

- [ ] 1. **Why Sentry has no cron monitor.** Read-only: `apps/web/lib/ops/cron-monitor.ts`, the cron routes under
  `apps/web/app/api/cron/**`, the Sentry init files, and Sentry itself (`find_monitors`, `search_issues` for
  `cron-cmo`; reading is fine, changing is not). Likely causes: the check-in is queued but the function ends before
  it is sent (needs `await Sentry.flush()`), the DSN is not set at runtime on the server, or round 1 is not deployed.
  Fix what is code; write what is config under "For the owner". Add a `.check.ts` for whatever you fix.
- [ ] 2. **Watch the Modal `sweep`.** It runs every queued job each minute (`packages/engine/modal_app.py`). Simplest
  shape first: one Sentry cron check-in from the sweep (Python `sentry_sdk.crons`), monitor slug `modal-sweep`,
  `* * * * *`, a margin of a few minutes. No new dependency if `sentry_sdk` is already in the engine; if it is not,
  stop and ask the owner. Without a DSN it must be a no-op. pytest for the no-DSN path.
- [ ] 3. **Stuck-job signal.** If the sweep is alive but jobs still wait (a crash loop, the container quota), nothing
  says so. Add to `/api/health` (or its ops helper) the age of the oldest queued job, and report it as degraded past a
  threshold you justify from `modal_app.py`'s lease and sweep timings. Keep `/api/health` cheap: one indexed query.
- [ ] 4. **Secrets.** Run `gitleaks` once over the whole history (`gitleaks git --redact`, binary downloaded to the
  scratchpad, not the repo). Report findings to the owner in chat with the file, commit and kind, never the value.
  Then add `.github/workflows/secrets.yml` running gitleaks on each PR's diff, and a `.gitleaks.toml` allowlisting the
  local Supabase CLI demo keys (see `lighthouse.yml`'s comment) and test fixtures, nothing broader.
- [ ] 5. Update the backlog's §3 and §5 state columns for what round 1 and this session made true.
- [ ] 6. `/code-review` and the `security-review-checklist` skill on your diff, fix, commit (`git add` your paths
  only), `git pull --rebase`, push.

## Checks before each push

`npm run typecheck`, `cd apps/web && npm run check:contracts`; engine: `.venv312/bin/python -m pytest -q <your tests>`
and `ruff check .`.

## For the owner (write here, do not do)

- Sentry: the uptime monitor on `/api/health` and one alert rule (from the uptime plan), once item 1 shows check-ins.
- GitHub: turn on secret scanning's non-provider patterns (Settings → Code security).
- Any secret item 4 finds: rotate it at the provider first, then decide whether to rewrite history.
