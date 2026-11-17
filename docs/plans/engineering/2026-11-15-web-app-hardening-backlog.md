# Web app hardening: terms and a backlog

Owner, 2026-11-15: a list of the engineering terms worth knowing for a production web app, each with where OpenCMO
stands, so the owner can pick what to improve later. Not scheduled. Each item still gets its own plan before it is built.

State, as checked on `main` `fb2e003d` (CI in `.github/workflows/ci.yml` and `ai-evals.yml`, `apps/web/package.json`):

- **have**: in the repo and running.
- **partial**: there, but not run or not complete.
- **missing**: not found.
- (blank): a term to know; not checked against the repo.

## Recommended order

Ranked by what it does for a paying founder and for the owner's time:

1. **Run the Playwright e2e in CI**, against each PR's Vercel preview. The specs exist (`apps/web/e2e/`) but CI does not
   run them, so a broken button reaches `main`. This is "an agent presses every button".
2. **Lighthouse CI with a performance budget**: no check fails a PR when a page gets slower or heavier today.
3. **Secret scanning** (GitHub push protection, gitleaks in CI). The repo is public.
4. **Uptime monitoring and one alert channel**, so the owner learns the site is down before a founder does.
5. **Product analytics on the CMO funnel**: signup → website read → first approved post → paid. Without it there is no
   way to see where founders drop.
6. **A staging database or Supabase branching**, so tests stop running against production (`apps/web/.env.local` points
   at production today).

## 1. Testing

| Term | What it is | OpenCMO |
|---|---|---|
| E2E (end-to-end) test | A browser robot uses the app like a person: clicks, types, checks what shows | have: `.github/workflows/e2e.yml` runs the smoke set on each PR and push to `main`, and the whole suite on both apps nightly, against a local Supabase with fake models; whole suite green on 2026-11-16 (round 2) |
| Smoke test | A few fast checks after each deploy: sign-in works, the main pages load | partial: `test:e2e:smoke` (sign-in and the CMO loop) on each PR, not yet a required check; after each production deploy `.github/workflows/post-deploy.yml` runs `apps/web/scripts/smoke-production.mts` (GET only: `/api/health`, the catalogue price, public pages, CSP and HSTS, the bundle's Sentry DSN), skipped with a warning until the owner sets `PRODUCTION_URL` (round 3). No signed-in check after a deploy |
| Visual regression test | Screenshots compared with approved ones to catch broken layouts (Playwright `toHaveScreenshot`) | done (round 4): the CMO loop's six v2 screens at 1440 and 390, plus today in dark, in the nightly `full-v2` (`e2e/ui-v2-visual.spec.ts`; baselines from CI via `e2e.yml`'s `update_snapshots`); golden stills for `clip-motion` |
| Flaky test | A test that passes and fails on the same code; fix or quarantine it | have (rule): no retries in `playwright.config.ts`; a flaky spec is fixed, not retried (round 2 fixed a streaming race in `ui-v2-look`) |
| Fixture, mock, fake | Saved or invented data so tests cost nothing | have: `OPENCMO_AGENT_FAKE`, `lib/cmo/social/fixtures/` |
| Contract test | Checks that an API returns the agreed shape | have: `check:contracts` |
| LLM eval | Scores the quality of model output against cases | have: `ai-evals.yml` |
| Test coverage | The share of code that tests run through | |
| Preview deployment testing | e2e against the Vercel preview URL of each PR | missing, by choice: the preview is behind SSO and reads production; CI runs the e2e on a production build of the PR with a local Supabase instead |

## 2. Performance

| Term | What it is | OpenCMO |
|---|---|---|
| Core Web Vitals | LCP (main content shows), INP (response to a click), CLS (layout shift) | have: `@vercel/speed-insights` measures them in production |
| Lighthouse CI | Scores performance in CI and fails a PR when the score drops | partial: `.github/workflows/lighthouse.yml` on each PR (public pages, `apps/web/lighthouserc.cjs`); warnings only until 2026-11-22, then errors |
| Performance budget | Hard limits, e.g. under 200 kB of JS, LCP under 2.5 s | partial: LCP 2.5 s, CLS 0.1 and category scores in `lighthouserc.cjs`, as warnings until 2026-11-22; first-load JS of the CMO loop's routes and the editor checked against `apps/web/bundle-budget.json` in CI's `web` job, failing (round 3) |
| Bundle size, bundle analyzer | Which libraries make the JS heavy | done (round 4): per-route first-load JS budget (`scripts/bundle-budget.mts`, round 3); when it fails, CI builds again with `@next/bundle-analyzer` (`ANALYZE=1`) and uploads the client treemap as `bundle-report` |
| TTFB | Time to the server's first byte | |
| Cold start | The first call to a serverless function or Modal container is slow | |
| p50, p95, p99 latency | Median, slowest 5 %, slowest 1 % of response times; watch p95, not the average | |
| Load test, stress test | Many simulated users at once (k6, Artillery) | missing |
| N+1 query | A database call inside a loop; the classic slowdown | not checked: round 3 indexed the foreign keys only; no route audit yet |
| Index, `EXPLAIN ANALYZE` | How Postgres runs a query and whether it uses an index | have: production's advisors clean (round 3, `20270127010000`: 38 foreign-key indexes, `(select auth.uid())` in RLS, a primary key on `write_budget_ledger`); `supabase/tests/320_advisor_guard` fails CI on a per-row `auth.uid()` policy. 15 unused indexes kept, re-read 2027-01-15 |
| Connection pooling | Sharing database connections (Supabase Supavisor) | have: nothing opens a Postgres connection itself; the web app and the worker go through PostgREST (HTTP), which pools (checked 2026-11-17) |
| Caching | CDN, ISR, `"use cache"`, stale-while-revalidate: keep a result instead of computing it again | |
| Code splitting, lazy loading | Load only the code of the page in use | |
| Memory leak | RAM that grows and never comes back | |

## 3. Reliability and operations

| Term | What it is | OpenCMO |
|---|---|---|
| Observability | Logs, metrics and traces | partial: Sentry (`@sentry/nextjs`) wired, but production's DSN was cut off and nothing reached Sentry until the owner fixes it (round 2); a bad DSN now logs `sentry_dsn_invalid` at boot and shows on Live switches. The worker's silent fallbacks (Scribe failed, no face detector) are now codes in `media_manifest.warnings`, shown on `/app/settings/failures` (round 4, B) |
| Distributed tracing | Following one request through web → Supabase → Modal | |
| Uptime / synthetic monitoring | A bot calls the site every minute and alerts when it fails | partial: `/api/health` ready; the Sentry uptime monitor waits on the owner. Cron monitors for Modal's three web crons and the `sweep` heartbeat (`modal-sweep`) report once the DSNs are set |
| Alerting, on-call | A message (Telegram, Slack, email) when a threshold is crossed | partial: `/api/cron/failures` sends one Sentry event per new failure group each hour (fingerprinted, so Sentry's "new issue" rule emails once per group; round 4, B); cron and uptime monitors exist. Waits on the owner's Sentry alert rule; no on-call rotation (one person) |
| SLO, SLA, error budget | A stability promise, e.g. 99.9 % of requests succeed | |
| Health check endpoint | A route such as `/api/health` that says the system is alive | have: `/api/health` (web, database, oldest queued job; 503 past 10 minutes) |
| Retry with exponential backoff | Try again, waiting longer each time | |
| Idempotency key | Sending a request twice does not charge twice | have: Creem grants once per transaction or order |
| Circuit breaker | Stop calling a provider that is down for a while | |
| Graceful degradation, fallback | One part fails, the rest keeps working | have: e.g. social reads fall back from LurkAPI to ScrapeCreators |
| Dead letter queue | Where failed jobs wait to be read and run again | partial: leases requeue a dead attempt up to three times; a stuck queue fails `/api/health`; the owner reads every failed or stuck piece of work, grouped by error, at `/app/settings/failures` (round 3, C), with uploads published with a fallback under "Warnings" (round 4, B), and hears of a new group through Sentry. Re-running is still the founder's button |
| Rate limiting | A cap on requests per user or IP | have |
| Backup, PITR | Restore the database to a point in time | |
| RTO, RPO | How long a restore takes; how much data may be lost | |
| Incident, postmortem | A written record of an outage and what was learned | done: `docs/runbooks/incident.md` (how the owner learns, the first ten minutes, telling founders, a postmortem template; round 4, B); `/app/settings/failures` is the evidence a postmortem starts from |

## 4. Deploy and CI/CD

| Term | What it is | OpenCMO |
|---|---|---|
| Feature flag | Turn a feature on or off without a deploy | partial: env switches (e.g. `LURK_API_KEY`, `NEXT_PUBLIC_OPENCMO_UI`) |
| Canary, rolling release | Ship a new version to a small share of users first | |
| Blue-green deployment | Two environments, switch between them at once | |
| Rollback | Go back to the previous deploy (one button on Vercel) | |
| Staging environment | A production-like place to try changes | missing |
| Database branching | A database per PR (Supabase Branching) | missing |
| Expand → contract migration | Change a schema in two steps so the old code keeps working | |
| Required status checks, branch protection | `main` takes merges only through green PRs | have |
| Dependabot, Renovate | Dependency update PRs | have |
| Secret rotation | Replacing keys on a schedule | |
| Infrastructure as Code | Infrastructure described in code (`vercel.ts`, Terraform) | |

## 5. Security

| Term | What it is | OpenCMO |
|---|---|---|
| OWASP Top 10 | The ten most common web vulnerability classes; worth reading once | |
| XSS, CSRF, SQL injection, SSRF | The classic attacks; SSRF matters wherever the app fetches a URL a user gave | have: SSRF guard `apps/web/lib/net/address.ts` |
| IDOR, broken access control | Change an id in a URL and see someone else's data; OWASP's first item | |
| RLS | Row Level Security in Postgres, the main guard against IDOR | have |
| Prompt injection | Outside text makes a model follow an attacker's instructions; Sales reads Reddit and Threads | have: `lib/cmo/untrusted.ts` |
| SAST, DAST | Scanning the code (CodeQL, Semgrep) and the running app (OWASP ZAP) | partial: CodeQL; OWASP ZAP baseline (passive) nightly against a local production build (`.github/workflows/dast.yml`, `.zap/rules.tsv`), warnings only until a week of green runs (round 3). No active scan |
| SCA | Scanning dependencies for known vulnerabilities (`npm audit`, Dependabot) | have: Dependabot |
| Secret scanning | Catching keys committed to the repo (gitleaks, push protection) | have: GitHub secret scanning and push protection; gitleaks on each PR (`secrets.yml`); full history scanned 2026-11-16, no live secret. Off: GitHub's non-provider patterns (owner) |
| Supply chain attack | A malicious npm package; lockfiles and pinned versions limit it | |
| CSP, security headers | Content Security Policy, HSTS, X-Frame-Options | have: `apps/web/next.config.ts` (`script-src 'unsafe-inline'`, no nonce: owner decision 2026-11-16) |
| Least privilege | Each key has only the rights it needs | partial: every function `authenticated` can call is listed (`182_*`); trigger functions revoked and anon calls no security definer function but `email_unsubscribe` (`320_*`); service-role-only tables hold no user grant (`321_*`). have (round 4, A): `anon` and `authenticated` hold only the table rights the app reads (`anon` select on `billing_catalog`; `authenticated` select on 56 tables and views, no write, no truncate, no sequence), new tables and sequences start with none, and `323_*` lists every grant (`20270129010000_table_grants`) |
| 2FA, MFA | On GitHub, Vercel, Supabase, Creem, Modal | |
| Audit log | Who did what, and when | |
| WAF, bot protection | Vercel Firewall, BotID | |
| Pentest, bug bounty | Paying people to attack the app | |

## 6. Product and growth

| Term | What it is | OpenCMO |
|---|---|---|
| Product analytics, event tracking | What users do (PostHog, Mixpanel) | missing |
| Funnel | Signup → onboarding → first approved post → paid | |
| Activation, aha moment | The first time a user sees the value | partial: an activation event from CMO review 3 |
| Retention, cohort analysis | Share of users still active after 1, 4, 12 weeks | |
| Churn, MRR, LTV, CAC | Leaving rate, monthly recurring revenue, lifetime value, cost to win a customer | |
| A/B test | Two versions, measure which does better | |
| Session replay | Watch a user's session back (Sentry can) | |
| NPS, in-app feedback | Ask users how satisfied they are, inside the app | |

## 7. Frontend quality

| Term | What it is | OpenCMO |
|---|---|---|
| Accessibility (a11y), WCAG | Usable with a keyboard and a screen reader (check with axe-core) | |
| Responsive, mobile-first | Works from 390 px up | |
| Optimistic UI | The screen updates before the server answers | |
| Loading, empty and error states | Every screen has all three | |
| i18n | More than one language | |
| SEO, AEO | Meta tags, sitemap, structured data for the landing page and blog | |
