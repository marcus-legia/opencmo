# Web hardening, round 3

Owner, 2026-11-17. Source: [`2026-11-15-web-app-hardening-backlog.md`](2026-11-15-web-app-hardening-backlog.md).
Round 1 (2026-11-15: #218, #219, #221) shipped five of the six items in the backlog's recommended order; the sixth
(a staging database) is deferred on purpose (round 2 plan, "For the owner"). Round 2
([`2026-11-16-web-hardening-round-2-plan.md`](2026-11-16-web-hardening-round-2-plan.md), PR #227) made those checks
work. This round takes the next gaps that real evidence points at. Three sessions, one branch
(`claude/wrb-hardening-review-1eiien`), one PR.

**This branch starts from PR #227's head (`4d7fac5`)**, because sessions B and C build on round 2's `lib/ops/**`.
The PR targets #227's branch until #227 merges, then `main`. Merge #227 first.

## Where round 2 stands (checked 2026-11-17)

- PR #227: every check green (e2e smoke, Lighthouse, gitleaks, database, engine, web, CodeQL), whole-branch review
  done in `4d7fac5`. Not merged.
- Left over, done on this branch before the sessions start: session B's item 6 ticked (its review is `4d7fac5`).
- Left over, taken by session B here: `next.config.ts` fails the build when `NEXT_PUBLIC_SENTRY_DSN` is set but
  cannot be parsed (round 2's review note), so a cut-off DSN stops at deploy instead of silencing Sentry again.
- Owner steps from round 2 still open: fix the Sentry DSN on Vercel and redeploy, add `SENTRY_DSN` to Modal's secret,
  the Sentry uptime monitor and alert rule, GitHub's non-provider secret patterns. Nothing in this round replaces
  them; the new smoke workflow (B) checks the first one after each deploy.

## What the evidence says (2026-11-17)

1. **Supabase advisors on production** (read-only, `get_advisors`):
   - security: 22 functions with a mutable `search_path` (`function_search_path_mutable`), 4 `security definer`
     functions executable by `anon` (`handle_new_user`, `refund_media_captions_from_task` — both trigger functions —
     `email_unsubscribe`, and `rls_auto_enable`, which is not in our migrations), leaked-password protection off in
     Auth (an owner setting), 19 tables with RLS and no policy (intended: service-role only; confirm, don't change).
   - performance: 8 RLS policies call `auth.uid()` per row instead of `(select auth.uid())` (`auth_rls_initplan`:
     `jobs`, `clips`, `scene_codes`, `editor_skills`, `editor_feedback`, `mcp_grants`, `work_order_usage`,
     `credit_orders`); 39 foreign keys without a covering index; `write_budget_ledger` has no primary key; 15 unused
     indexes (the database is two months old, too young to drop any).
2. **Nothing checks production after a deploy.** CI tests the PR's code on a local stack; the deploy itself (env,
   DSN, catalogue, headers) is only seen by founders. Round 2 found a cut-off Sentry DSN that way, a week late.
3. **No dynamic scan (DAST)** and **no JS size budget for the signed-in app** (Lighthouse covers four public pages).
4. **Failures founders hit are invisible to the owner.** `jobs.error`, `tasks.error`, `cmo_runs.error`,
   `generations`, `studio_steps` hold the error text a founder reads, but no page lists them; Sentry only sees
   exceptions, not a job that ended `failed` with a clean message (CLAUDE.md "Known traps": a Scribe failure, face
   tracking).

Already in place, so not in this round: route auth (`withApi` on every `/api/v1` route, `handler.check.ts`), SSRF
guard, CSP and headers, Actions pinned by SHA, error/not-found/loading pages, sitemap and robots, fetch timeouts on
provider calls.

## Sessions

| Session | Goal | Owns | Checklist |
|---|---|---|---|
| **A — database** | Production's advisors clean, and a pgTAP guard so they stay clean | `supabase/migrations/20270127*` (new), `supabase/tests/319_*`–`321_*` (new), `supabase/tests/182_authenticated_function_allowlist.test.sql` (block "A"), `supabase/schema/current.sql` (regenerated) | [`a-database.md`](2026-11-17-web-hardening-round-3-plan-sessions/a-database.md) |
| **B — release safety** | Every production deploy is checked within minutes; a nightly DAST; a JS budget for the app | `.github/workflows/post-deploy.yml` (new), `.github/workflows/dast.yml` (new), `.zap/**` (new), `.github/workflows/ci.yml` (the `web` job's steps only), `apps/web/next.config.ts`, `apps/web/lib/ops/sentry-dsn.ts`, `apps/web/scripts/smoke-production.mts` (new), `apps/web/scripts/bundle-budget.mts` (new), `apps/web/bundle-budget.json` (new) | [`b-release-safety.md`](2026-11-17-web-hardening-round-3-plan-sessions/b-release-safety.md) |
| **C — failures the owner sees** | One owner page lists what failed for founders this week, grouped by error | `supabase/migrations/20270128*` (new), `supabase/tests/322_*` (new), `supabase/tests/182_…` (block "C": one line), `apps/web/lib/ops/failures.ts`, `failures.check.ts` (new), `apps/web/app/app/settings/failures/**` (new), `apps/web/app/app/settings/page.tsx` (the owner links only) | [`c-failures.md`](2026-11-17-web-hardening-round-3-plan-sessions/c-failures.md) |

Order and waits:

- A, B and C start at once. None needs another's code.
- **Shared files**:
  - `supabase/tests/182_authenticated_function_allowlist.test.sql`: A owns the file; C adds only its one function line.
    On a rebase conflict, keep both sides.
  - `supabase/schema/current.sql` is generated. Whoever commits a migration regenerates it after `git pull --rebase`;
    on a conflict, take either side and run `scripts/dump-schema.sh` again. Never hand-edit it.
  - Migration timestamps are fixed above (A `20270127…`, C `20270128…`) so the order never depends on who pushes first.
  - The backlog's state columns: A edits only §3 "Index", "Connection pooling" and §2 "N+1 query", "Index, `EXPLAIN
    ANALYZE`" rows and §5 "Least privilege"; B edits §1 "Smoke test", §2 "Bundle size", "Performance budget", §5
    "SAST, DAST"; C edits §3 "Dead letter queue", "Incident, postmortem". Nothing else in it.
- `CLAUDE.md` and `apps/web/lib/supabase/admin.ts` are nobody's: if a session needs a line there, it writes it in its
  checklist's "For the lead" and the lead adds it in the whole-branch pass.

## Rules for every session

- Same branch. Commit only your own paths (`git add <paths>`, never `git add -A`), then `git pull --rebase` before
  `git push`. Never switch branch, never stash, never force-push.
- **Run heavy suites one at a time.** A and C both run `npm run db:reset && npm run db:test`: whoever starts first says
  so over `SendMessage`, the other waits. B's `next build` and ZAP run can go at the same time as pgTAP, but not as
  another build.
- **Code review before every push** (owner, 2026-11-17: "nhớ có code review"):
  1. `/code-review high` on your own diff (`git diff origin/claude/wrb-hardening-review-1eiien...`, plus unpushed
     commits). Fix every finding it confirms.
  2. `security-review-checklist` skill on the same diff (all three sessions touch SQL, CI or an owner-only surface).
  3. A and C also follow the `supabase-migrations` skill before writing SQL.
  4. The commit message ends with one line: what review found, what was fixed, and what was left and why.
- Each commit is green on its own for what it touches (the "Checks before each push" in your checklist).
- Nothing that changes an outside account (Supabase settings, Vercel, GitHub settings, Sentry, Modal) without the
  owner's yes in chat. Read-only calls (advisors, logs) are fine. Write the step under "For the owner" instead.
- English everywhere; comments say why.

## After all three sessions (the lead, this session)

Done 2026-11-17 (`686b262`): all three checklists ticked; whole-branch review found 8, fixed 4 (the commit lists the
4 kept and why); the "For the lead" lines are in `CLAUDE.md` and `ci.yml`; the PR description is written.

1. Every checklist ticked, or the reason it is not written beside it.
2. Whole-branch `/code-review high` on `origin/claude/web-hardening-plan-e5d0c4...HEAD` (or `origin/main...HEAD` once
   #227 has merged), plus the `security-review-checklist` skill. Fix, one review commit.
3. The lines each session left under "For the lead" (`CLAUDE.md`, `admin.ts`).
4. PR description: what each session changed, the advisors before and after, the checks' results, and the owner steps
   from all three checklists in order. Then mark the PR ready.

## For the owner (not for the sessions)

- **Merge #227 first**, then fix the Sentry DSN (Vercel, redeploy) and Modal's `SENTRY_DSN` (round 2's steps).
- **Supabase → Auth → leaked-password protection: on.** One switch; it rejects passwords found in known breaches.
- **2026-11-22:** Lighthouse budgets become errors (`apps/web/lighthouserc.cjs`, round 2 note).
- **Staging database:** still not now (round 2's reasoning holds).
