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
| E2E (end-to-end) test | A browser robot uses the app like a person: clicks, types, checks what shows | partial: Playwright specs in `apps/web/e2e/`, not in CI |
| Smoke test | A few fast checks after each deploy: sign-in works, the main pages load | missing |
| Visual regression test | Screenshots compared with approved ones to catch broken layouts (Playwright `toHaveScreenshot`) | partial: golden stills for `clip-motion`, none for the web app |
| Flaky test | A test that passes and fails on the same code; fix or quarantine it | |
| Fixture, mock, fake | Saved or invented data so tests cost nothing | have: `OPENCMO_AGENT_FAKE`, `lib/cmo/social/fixtures/` |
| Contract test | Checks that an API returns the agreed shape | have: `check:contracts` |
| LLM eval | Scores the quality of model output against cases | have: `ai-evals.yml` |
| Test coverage | The share of code that tests run through | |
| Preview deployment testing | e2e against the Vercel preview URL of each PR | missing |

## 2. Performance

| Term | What it is | OpenCMO |
|---|---|---|
| Core Web Vitals | LCP (main content shows), INP (response to a click), CLS (layout shift) | have: `@vercel/speed-insights` measures them in production |
| Lighthouse CI | Scores performance in CI and fails a PR when the score drops | missing |
| Performance budget | Hard limits, e.g. under 200 kB of JS, LCP under 2.5 s | missing |
| Bundle size, bundle analyzer | Which libraries make the JS heavy | |
| TTFB | Time to the server's first byte | |
| Cold start | The first call to a serverless function or Modal container is slow | |
| p50, p95, p99 latency | Median, slowest 5 %, slowest 1 % of response times; watch p95, not the average | |
| Load test, stress test | Many simulated users at once (k6, Artillery) | missing |
| N+1 query | A database call inside a loop; the classic slowdown | |
| Index, `EXPLAIN ANALYZE` | How Postgres runs a query and whether it uses an index | |
| Connection pooling | Sharing database connections (Supabase Supavisor) | |
| Caching | CDN, ISR, `"use cache"`, stale-while-revalidate: keep a result instead of computing it again | |
| Code splitting, lazy loading | Load only the code of the page in use | |
| Memory leak | RAM that grows and never comes back | |

## 3. Reliability and operations

| Term | What it is | OpenCMO |
|---|---|---|
| Observability | Logs, metrics and traces | have: Sentry (`@sentry/nextjs`) |
| Distributed tracing | Following one request through web → Supabase → Modal | |
| Uptime / synthetic monitoring | A bot calls the site every minute and alerts when it fails | missing |
| Alerting, on-call | A message (Telegram, Slack, email) when a threshold is crossed | |
| SLO, SLA, error budget | A stability promise, e.g. 99.9 % of requests succeed | |
| Health check endpoint | A route such as `/api/health` that says the system is alive | |
| Retry with exponential backoff | Try again, waiting longer each time | |
| Idempotency key | Sending a request twice does not charge twice | have: Creem grants once per transaction or order |
| Circuit breaker | Stop calling a provider that is down for a while | |
| Graceful degradation, fallback | One part fails, the rest keeps working | have: e.g. social reads fall back from LurkAPI to ScrapeCreators |
| Dead letter queue | Where failed jobs wait to be read and run again | |
| Rate limiting | A cap on requests per user or IP | have |
| Backup, PITR | Restore the database to a point in time | |
| RTO, RPO | How long a restore takes; how much data may be lost | |
| Incident, postmortem | A written record of an outage and what was learned | |

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
| XSS, CSRF, SQL injection, SSRF | The classic attacks; SSRF matters wherever the app fetches a URL a user gave | |
| IDOR, broken access control | Change an id in a URL and see someone else's data; OWASP's first item | |
| RLS | Row Level Security in Postgres, the main guard against IDOR | have |
| Prompt injection | Outside text makes a model follow an attacker's instructions; Sales reads Reddit and Threads | have: `lib/cmo/untrusted.ts` |
| SAST, DAST | Scanning the code (CodeQL, Semgrep) and the running app (OWASP ZAP) | partial: CodeQL, no DAST |
| SCA | Scanning dependencies for known vulnerabilities (`npm audit`, Dependabot) | have: Dependabot |
| Secret scanning | Catching keys committed to the repo (gitleaks, push protection) | missing |
| Supply chain attack | A malicious npm package; lockfiles and pinned versions limit it | |
| CSP, security headers | Content Security Policy, HSTS, X-Frame-Options | |
| Least privilege | Each key has only the rights it needs | |
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
