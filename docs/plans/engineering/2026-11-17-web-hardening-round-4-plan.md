# Web hardening, round 4

Owner, 2026-11-17: "PR 227 and 228 are web hardening; do what is not done yet, split for 3 sessions, code review when
done." Source: what rounds 2 and 3 left for later ([round 2](2026-11-16-web-hardening-round-2-plan.md), PR #227;
[round 3](2026-11-17-web-hardening-round-3-plan.md), PR #228) and the
[backlog](2026-11-15-web-app-hardening-backlog.md). Three sessions, one branch
(`claude/web-hardening-prs-227-228-gqrgl9`), one PR.

**This branch starts from PR #228's head (`7d6005b`)**, which sits on #227. The PR targets #228's branch until #227
and #228 merge, then `main`. Merge order: #227, #228, this one.

## Where rounds 2 and 3 stand (checked 2026-11-17)

- Every checklist item of both rounds is ticked; both PRs are green (database, web, engine, e2e smoke, Lighthouse,
  gitleaks); both had a whole-branch review (`4d7fac5`, `686b262`). Nothing to finish inside them; they wait on the
  owner's merge and the owner steps in #228's description.
- What they left for later, with the evidence:
  1. **About 40 older `public` tables keep Supabase's default full grants** (`select`, `insert`, `update`,
     `delete`, `truncate`, `references`, `trigger`) to `anon` and `authenticated`; RLS is the only thing holding
     them back (round 3, session A, "For the lead"). One table whose RLS gets switched off, or one permissive policy,
     and the whole table opens to the public anon key.
  2. **The worker's silent fallbacks are still invisible.** A Scribe failure publishes a video with no transcript,
     and a missing face detector frames the speaker in the centre (CLAUDE.md "Known traps"). Neither ends `failed`,
     so `/app/settings/failures` does not list them. In the engine they cannot even be told apart today:
     `process_job._transcribe` returns `None` for "no speech" and for "Scribe failed", and `_focus` returns `None`
     both when no tracking was needed and when the detector was missing (round 3, session C, "out of scope").
  3. **No alert when founders start failing.** The failures page is read only when the owner opens it (round 3, C);
     the backlog's "Alerting" row is still "missing", and "Incident, postmortem" has no written template.
  4. **No visual regression test for the web app** (backlog §1: golden stills for `clip-motion` only). Round 2 found
     two layout bugs in the CMO loop's v2 screens by accident (two `v2-dashboard` nodes, a page scroll at 390 px).
  5. **The JS budget says a route grew, not which library grew** (backlog §2 "Bundle size": no analyzer).

Not in this round, on purpose: a staging database (round 2's reasoning holds), a signed-in check after each production
deploy (it would need a standing account and credits in production: owner decision first), load tests, an N+1 audit
of routes (no slow route in Speed Insights yet).

## Sessions

| Session | Goal | Owns | Checklist |
|---|---|---|---|
| **A — table grants** | `anon` and `authenticated` hold only the table rights the app uses; a new table starts with none; a pgTAP guard keeps it so | `supabase/migrations/20270129*` (new), `supabase/tests/323_*`–`324_*` (new), `supabase/tests/010_rls.test.sql` (only assertions the revoke changes), `supabase/schema/current.sql` (regenerated) | [`a-table-grants.md`](2026-11-17-web-hardening-round-4-plan-sessions/a-table-grants.md) |
| **B — silent failures and alerts** | The owner reads the worker's fallbacks next to the failures, and hears from Sentry when a new group of founder failures appears; an incident runbook | `packages/engine/opencmo/worker/process_job.py`, `packages/engine/opencmo/backends/supabase/jobs.py`, `packages/engine/tests/**` (new tests only), `supabase/migrations/20270130*` (new), `supabase/tests/325_*` (new), `supabase/tests/182_…` (block "B"), `apps/web/lib/ops/failures.ts`, `failures.check.ts`, `apps/web/lib/ops/failure-alerts*.ts` (new), `apps/web/app/app/settings/failures/**`, `apps/web/app/api/cron/failures/**` (new), `packages/engine/modal_app.py` (the hourly digest function only), `docs/runbooks/incident.md` (new) | [`b-silent-failures.md`](2026-11-17-web-hardening-round-4-plan-sessions/b-silent-failures.md) |
| **C — the loop's screens stay put** | A screenshot test of the CMO loop's v2 screens at 1440 and 390 px in the nightly suite; a bundle report when the JS budget fails | `apps/web/e2e/ui-v2-visual.spec.ts` (new), its snapshot folder (new), `apps/web/playwright.config.ts` (snapshot settings only), `.github/workflows/e2e.yml`, `.github/workflows/ci.yml` (the `web` job's budget step only), `apps/web/package.json` (scripts and one devDependency), `apps/web/next.config.ts` (the analyzer wrapper only), `apps/web/scripts/bundle-budget.mts`, and app components a screenshot proves broken | [`c-visual.md`](2026-11-17-web-hardening-round-4-plan-sessions/c-visual.md) |

Order and waits:

- A, B and C start at once, each in **its own cloud container** (so heavy suites never share a machine; the
  "one at a time" rule of earlier rounds is about one machine).
- **Shared files**:
  - `supabase/schema/current.sql` is generated. Whoever commits a migration regenerates it after `git pull --rebase`;
    on a conflict, take either side and run `scripts/dump-schema.sh` again. Never hand-edit it.
  - `supabase/tests/182_authenticated_function_allowlist.test.sql`: B adds its function lines in a block "B". A adds
    nothing (A changes table grants, not functions). On a rebase conflict, keep both sides.
  - Migration timestamps are fixed (A `20270129…`, B `20270130…`) so the order never depends on who pushes first.
    **A's revoke runs before B's migration**: any new table or view B creates must grant exactly what B's code needs,
    and must be added to A's allowlist in `323_*` (B writes the line in its checklist's "For A"; A, or the lead,
    adds it).
  - `apps/web/next.config.ts`: C adds only the analyzer wrapper. Nobody else edits it this round.
  - The backlog's state columns: A edits §5 "Least privilege"; B edits §3 "Observability", "Alerting, on-call",
    "Dead letter queue", "Incident, postmortem"; C edits §1 "Visual regression test" and §2 "Bundle size, bundle
    analyzer". Nothing else in it.
- `CLAUDE.md` and `apps/web/lib/supabase/admin.ts` are nobody's: a session that needs a line there writes it under
  "For the lead" in its checklist.

## Rules for every session

- Same branch. Commit only your own paths (`git add <paths>`, never `git add -A`), then `git pull --rebase` before
  `git push`. Never switch branch, never stash, never force-push.
- **Code review before every push** (owner, 2026-11-17):
  1. `/code-review high` on your own diff (`git diff origin/claude/web-hardening-prs-227-228-gqrgl9...`, plus
     unpushed commits). Fix every finding it confirms.
  2. `security-review-checklist` skill on the same diff.
  3. A and B follow the `supabase-migrations` skill before writing SQL; B follows `ffmpeg-ram-budget` if it touches an
     ffmpeg call (it should not need to).
  4. The commit message ends with one line: what review found, what was fixed, what was left and why.
- Each commit is green on its own for what it touches (the "Checks before each push" in your checklist).
- Nothing that changes an outside account (Supabase, Vercel, GitHub settings, Sentry, Modal) without the owner's yes
  in chat. Read-only calls are fine. Write the step under "For the owner" instead.
- English everywhere; comments say why. When done, tick your checklist, write "Done" with what you verified at its
  end, and push.

## After all three sessions (the lead, this session)

1. Every checklist ticked, or the reason it is not written beside it.
2. Whole-branch `/code-review high` on `origin/claude/wrb-hardening-review-1eiien...HEAD` (or `origin/main...HEAD`
   once #227 and #228 have merged), plus the `security-review-checklist` skill. Fix, one review commit.
3. The lines each session left under "For the lead" (`CLAUDE.md`, `admin.ts`, A's allowlist lines from B).
4. PR description: what each session changed, the checks' results, the owner steps from all three checklists in
   order. Then mark the PR ready.

## For the owner (not for the sessions)

- Merge order: #227, #228, then this PR. `supabase db push` after each, before its web deploy.
- Round 3's open steps still hold (#228's description: Email provider off, `rls_auto_enable`, `PRODUCTION_URL`).
