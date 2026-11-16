# Web hardening, round 2

Owner, 2026-11-16. Round 1 (2026-11-15) shipped four of the six items in the backlog's recommended order
([`2026-11-15-web-app-hardening-backlog.md`](2026-11-15-web-app-hardening-backlog.md)): e2e in CI (#218), Lighthouse CI,
`/api/health` + Sentry cron monitors (#219), and the CMO funnel page (#221). This round makes those checks trustworthy
and closes the gaps found while reviewing them. Two sessions, one branch (`claude/web-hardening-plan-e5d0c4`), one PR.

## What the review found (checked 2026-11-16, `main` `f4f235be`)

1. **The nightly e2e is red.** Run `43843071368` (2026-11-16 02:17 UTC): `full-v1` 5 failed / 27 passed,
   `full-v2` 3 failed / 100 passed. A check that is always red teaches everyone to ignore it, so the smoke set cannot
   become a required check until the whole suite is green.
   - `full-v1`: `api-contract`, `cmo` (expects "Added to your calendar", gets "Ordering a script for the video you
     record" — the test predates "the founder makes the videos"), `design` (an element out of the viewport),
     `editor-explainer`, `editor-generate`.
   - `full-v2`: `ui-v2-look` dashboard (`getByTestId('v2-dashboard')` matches 2 elements) and schedule (axe result or
     page scroll at 390 px), `ui-v2-writer` "filters drafts per platform" (gets `x`, expects `linkedin`; already
     excluded from the smoke set, so it has been failing quietly).
2. **Sentry shows no cron monitor and no uptime monitor.** The cron check-ins (`apps/web/lib/ops/cron-monitor.ts`)
   create their monitor on the first check-in, so an empty list means the check-ins never reached Sentry in
   production (not deployed, no DSN at runtime, or the check-in is dropped before the serverless function ends).
   The monitoring shipped in round 1 is not running yet.
3. **The Modal `sweep` is still unwatched.** It runs every queued job each minute; if it stops, jobs stay queued and
   nobody is told (out of scope in the uptime plan).
4. **Secret scanning: GitHub's side is on** (secret scanning and push protection enabled; the repo is public). Off:
   non-provider patterns (generic keys, passwords in URLs). No history scan has been run.
5. Already in place, so not in this round: CSP and security headers (`apps/web/next.config.ts`), SSRF guard
   (`apps/web/lib/net/address.ts`), RLS isolation e2e, axe checks in the v2 specs, Dependabot, CodeQL.

## Sessions

| Session | Owns | Checklist |
|---|---|---|
| **A — green suite** | `apps/web/e2e/**`, `.github/workflows/e2e.yml`, `.github/workflows/lighthouse.yml`, `apps/web/lighthouserc*`, and the app components a failing spec proves broken (dashboard, schedule, writer screens under `apps/web/components/**` and `apps/web/app/(app)/**`) | [`a-green-suite.md`](2026-11-16-web-hardening-round-2-plan-sessions/a-green-suite.md) |
| **B — ops and secrets** | `apps/web/lib/ops/**`, `apps/web/app/api/health/**`, `apps/web/app/api/cron/**`, `apps/web/instrumentation*.ts`, `apps/web/sentry.*.config.ts`, `packages/engine/**`, `.github/workflows/secrets.yml` (new), `.gitleaks.toml` (new) | [`b-ops-secrets.md`](2026-11-16-web-hardening-round-2-plan-sessions/b-ops-secrets.md) |

Shared file: the backlog's state columns. Each session edits only its own rows (A: §1 Testing, §2 Performance; B: §3
Reliability, §5 Security) and nothing else in it.

Rules for both:

- Same checkout, same branch. Commit only your own paths (`git add <paths>`, never `git add -A`), then
  `git pull --rebase` before `git push`. Never switch branch, never stash.
- **Run heavy suites one at a time.** A runs the e2e (local Supabase + Next.js); B does not run `npm run dev`, a build or
  the engine's full pytest while A's e2e is running — ask A over `SendMessage` first. `test_web_sql_concurrency`
  fails while a dev worker runs.
- **Code review before every push**: run `/code-review` on your own diff (and the `security-review-checklist` skill for
  B, which touches secrets and the worker). Fix what it confirms; note in the commit what you chose not to fix and why.
- Nothing that changes an outside account (Sentry, GitHub settings, Vercel, Supabase, Modal) without the owner's yes in
  chat. Write the step down in "For the owner" instead.

## After both sessions (this session)

1. A whole-branch `/code-review` on `main...HEAD`, fixes, then the PR description lists what each session changed.
2. Owner steps collected from both checklists, in order.

## For the owner (not for the sessions)

- A **staging database / Supabase Branching** (backlog item 6): not now. CI already runs every suite against a local
  Supabase, which was the main reason for it. The remaining risk is a local script pointed at `apps/web/.env.local`
  (production); that is a habit, not infrastructure. Revisit when a second person deploys.
- **CSP nonce** instead of `script-src 'unsafe-inline'`: a nonce makes every page dynamic (no static landing or blog),
  which costs the Lighthouse budget just set up. Not worth it while the app renders no user HTML unsanitised.
- **Supabase PITR and the backup schedule**: check the plan in the Supabase dashboard; nothing to build.
