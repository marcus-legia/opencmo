# Session C — failures the owner sees

Plan: [`../2026-11-17-web-hardening-round-3-plan.md`](../2026-11-17-web-hardening-round-3-plan.md). Waits on nothing.
Coordinate `db:reset`/`db:test` runs with session A (`SendMessage`), one at a time.

Goal: the owner opens one page and sees what failed for founders in the last 7, 30 or 90 days, grouped by the error
text the founder read, with how many accounts it hit, so a failure is fixed before it becomes churn. Sentry sees
exceptions; this sees work that ended `failed` with a clean message (CLAUDE.md "Known traps").

Owns: `supabase/migrations/20270128*` (new), `supabase/tests/322_*` (new), one line in
`supabase/tests/182_authenticated_function_allowlist.test.sql`, `apps/web/lib/ops/failures.ts`,
`apps/web/lib/ops/failures.check.ts` (new; add it to `check:contracts` in `apps/web/package.json`, that line only),
`apps/web/app/app/settings/failures/**` (new), `apps/web/app/app/settings/page.tsx` (the owner links only). Read the
`supabase-migrations` skill first.

## Todo, in order

- [ ] 1. **Map the failures.** In `supabase/schema/current.sql`, list every table where work ends failed or blocked
  with a message: at least `jobs`, `tasks`, `cmo_runs`, `generations`, `studio_steps`, `work_orders`. Write the list
  (table, status value, error column, the `kind` that says what the work was) at the top of the migration. Include
  work stuck past its lease (`running` with an expired lease), since the founder sees it as hanging.
- [ ] 2. **`ops_failures_report(p_days int)`**, `security definer`, `search_path = ''`, owner-only exactly like
  `cmo_funnel_report` (`app_owners` by the caller's email, under the owner's own session; anyone else gets the same
  error a missing function would). Returns, per source and kind: failures, accounts hit, first and last seen, the
  error text grouped (trimmed, numbers and ids collapsed so one bug is one row), the 20 latest rows with their ids.
  Owner accounts left out. No email, no prompt, no document: ids only (the owner looks a user up in Supabase).
  `p_days` limited to 1–90. Grant to `authenticated`, revoke from `anon`, add it to 182.
- [ ] 3. **pgTAP `322_*`**: a non-owner gets nothing; owner accounts are excluded; grouping merges two failures that
  differ only by an id; a stuck lease counts; `p_days` out of range is refused.
- [ ] 4. **`lib/ops/failures.ts`** (rows, the grouping key for display, durations) and `failures.check.ts`.
- [ ] 5. **`/app/settings/failures`**, owner only (404 otherwise, like `/app/settings/funnel`), in the style of the
  costs and funnel pages: `?days=7|30|90`, the groups sorted by accounts hit, each with its latest rows. Link it from
  `/app/settings` next to Costs and Funnel, owners only. Empty state says nothing failed in the window.
- [ ] 6. Look at it: seed a few failures locally, take a 1440 px and a 390 px screenshot, check both by eye.
- [ ] 7. Update the backlog rows you own (plan, "Shared files").
- [ ] 8. **Review**: `/code-review high` on your diff, then the `security-review-checklist` skill (owner-only check, no
  data of another founder beyond ids and error text, `security definer` hygiene). Fix what is confirmed. Commit
  (`git add` your paths only, message ends with the review line), `git pull --rebase`, push.

## Checks before each push

`npm run db:reset && npm run db:test`, `scripts/dump-schema.sh`, `npm run typecheck`,
`cd apps/web && npm run check:contracts`.

## For the owner (write here, do not do)

- After the merge: `supabase db push` before the web deploy (a deploy first only gives the owner a 404 on this page).

## For the lead

(Lines that belong in `CLAUDE.md` or files C does not own.)

Out of scope, noted for later: an alert when one group crosses a threshold (would reuse the Sentry alert rule once
round 2's DSN is fixed); writing the worker's silent fallbacks (no transcript, centre framing) as warnings a page can
read.
