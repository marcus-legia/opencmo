# Lighthouse CI (hardening backlog, step 2)

Owner, 2026-11-15: "làm đợt 2". Source: [`2026-11-15-web-app-hardening-backlog.md`](2026-11-15-web-app-hardening-backlog.md),
recommended order item 2.

## Why

Speed Insights shows how fast production is, after the fact. Nothing stops a PR that adds a heavy library or an image
that shifts the layout. The pages that matter most for revenue are the public ones a founder lands on from a post.

## What

`.github/workflows/lighthouse.yml`, on each PR, each push to `main` and by hand:

1. A local Supabase with only what the public pages read (database, gateway, REST, auth), and a made-up catalogue
   (`apps/web/lighthouse/seed.sql`), so the landing page draws its pricing section as in production.
2. A production build of the commit (`next start` on port 3200), with the v2 app.
3. `@lhci/cli` 0.15.1 `autorun` with `apps/web/lighthouserc.cjs`: `/`, `/blog`, `/blog/write-x-thread`, `/login`,
   three runs each (the median counts), Lighthouse's default mobile profile (mid-range phone, slow 4G).
4. The HTML and JSON reports are uploaded as the `lighthouse-reports` artifact for 14 days. Nothing goes to a
   third-party server.

### Why not the Vercel preview

The preview is behind Vercel's SSO (302 to `vercel.com/sso-api`), so it needs a bypass secret that a fork's PR cannot
have, and it reads the production database. A local build measures the code, not Vercel's CDN; Speed Insights keeps
measuring the real thing.

## Budgets

All are **warnings** for the first week, so the job never blocks a PR while the baseline is unknown:

| Check | Budget |
|---|---|
| Performance score | ≥ 0.80 |
| Accessibility, best practices, SEO | ≥ 0.95 |
| Largest Contentful Paint | ≤ 2.5 s |
| Cumulative Layout Shift | ≤ 0.1 |
| Total Blocking Time | ≤ 200 ms |
| JavaScript per page (compressed) | ≤ 350 kB |

Timing checks (performance, LCP, CLS, TBT) take the median run. Accessibility, best practices and SEO do not depend on
timing, so they take the worst of the three runs. `/login` has no SEO budget: it is kept out of search on purpose.

### Baseline, 2026-11-15 (local production build, `main` `fb2e003d`, median run)

| Page | Perf | A11y | BP | SEO | LCP | CLS | TBT | JS |
|---|---|---|---|---|---|---|---|---|
| `/` | 0.91 | 0.96 | 0.96 | 0.91–1 | 3.16 s | 0.002 | 39 ms | 229 kB |
| `/blog` | 0.96 | 1.00 | 0.96 | 1.00 | 2.49 s | 0 | 26 ms | 159 kB |
| `/blog/write-x-thread` | 0.94 | 1.00 | 0.96 | 1.00 | 2.72 s | 0 | 26 ms | 161 kB |
| `/login` | 0.95 | 1.00 | 0.96 | (noindex) | 2.71 s | 0 | 24 ms | 234 kB |

What the first run found (each its own fix, not in this PR):

1. **The landing page's meta description is there on the first load and missing on the next two** (`meta-description`,
   SEO 1 → 0.91). Likely Next 16 streaming the metadata after the first byte for some agents. Crawlers and link
   previews may then miss it too: check with a social crawler's user agent, and fix first.
2. LCP is above 2.5 s on every page (3.16 s on `/`), on Lighthouse's slow-4G phone.
3. `/`: a colour pair below the WCAG contrast ratio (`color-contrast`), and browser errors in the console
   (`errors-in-console`; a local build without Sentry or Speed Insights may explain part of it).

After a week, the owner looks at the medians in the reports and sets each budget a little above them, as `error`
(then make `lighthouse` a required check). Tighten them when a page gets faster, never loosen to let a PR pass.

## Out of scope

- Pages behind sign-in (`/app/*`). They need a session cookie in Lighthouse (`puppeteerScript`) and seeded data; a
  later step, after the public pages have budgets.
- Lighthouse on the real CDN (preview with a bypass secret).
